/**
 * Pure-logic tests for `TaskToolBlock`'s wire-narrowing helpers, the
 * `Agent` dispatch routing, and the [D17] recursive depth threading.
 *
 * The wrapper component itself is decoration over composition
 * (`ToolWrapperChrome` + an `embedded` `AgentTranscriptBlock`) — its
 * behaviour *is* the exported pure helpers:
 *
 *  - `narrowAgentInput` / `narrowAgentStructured` — defensive
 *    narrowing of the `unknown` wire props.
 *  - `composeAgentTranscriptData` — `structured_result` →
 *    `AgentTranscriptData`; deep-narrows `content[]` blocks into
 *    transcript entries (text answers + nested `tool_use` blocks).
 *  - the dispatch routes `Agent` (and the historical `Task` alias) to
 *    the real `TaskToolBlock`.
 *  - a nested `tool_use` entry, dispatched at `depth + 1`, routes to
 *    its real wrapper and carries the incremented `depth` — the
 *    [D17] recursion contract.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  TaskToolBlock,
  composeAgentTranscriptData,
  narrowAgentInput,
  narrowAgentStructured,
} from "../task-tool-block";
import { GrepToolBlock } from "../grep-tool-block";
import {
  _resetToolWrapperRegistryForTests,
  dispatchToolCallState,
  registerToolWrapper,
  resolveToolWrapper,
} from "../../tide-assistant-renderer-dispatch";
import {
  AGENT_MAX_DEPTH,
  shouldCollapseAgentDepth,
} from "@/components/tugways/body-kinds/agent-transcript-block";
import type { ToolCallState } from "@/lib/code-session-store";

/** Build a minimal `ToolCallState` for the child-tool-call merge tests. */
function childCall(toolUseId: string, toolName: string): ToolCallState {
  return {
    toolUseId,
    toolName,
    input: {},
    status: "done",
    result: null,
    structuredResult: null,
    parentToolUseId: "agent-1",
    toolWallMs: null,
  };
}

// ---------------------------------------------------------------------------
// Synthetic fixtures — the catalog's only Agent probe
// (`test-22-subagent-spawn.jsonl`) carries a text-only `content[]`, so
// the nested-tool-call and depth cases use synthetic results per
// [#step-17].
// ---------------------------------------------------------------------------

/** Mirrors the real `test-22` Agent structured result — text-only content. */
const TEXT_ONLY_FIXTURE: unknown = {
  agentType: "Explore",
  status: "completed",
  content: [{ type: "text", text: "src/feed.rs\nsrc/lib.rs" }],
  totalDurationMs: 3566,
  totalTokens: 15700,
  totalToolUseCount: 1,
};

/** Content-mode fixture with a nested Grep `tool_use` block. */
const NESTED_GREP_FIXTURE: unknown = {
  agentType: "Explore",
  status: "completed",
  content: [
    { type: "text", text: "Searching…" },
    {
      type: "tool_use",
      id: "tu-grep-1",
      name: "Grep",
      input: { pattern: "FeedId", path: "/repo" },
    },
    { type: "text", text: "Done." },
  ],
  totalToolUseCount: 1,
};

/** Content-mode fixture with a nested Agent `tool_use` block (depth case). */
const NESTED_AGENT_FIXTURE: unknown = {
  agentType: "Plan",
  status: "completed",
  content: [
    {
      type: "tool_use",
      id: "tu-agent-1",
      name: "Agent",
      input: { subagent_type: "Explore", prompt: "dig deeper" },
    },
  ],
};

// ---------------------------------------------------------------------------
// narrowAgentInput
// ---------------------------------------------------------------------------

describe("narrowAgentInput", () => {
  test("keeps the wire fields when well-typed (subagent_type → subagentType)", () => {
    expect(
      narrowAgentInput({
        description: "Find refs",
        prompt: "search the workspace",
        subagent_type: "Explore",
      }),
    ).toEqual({
      description: "Find refs",
      prompt: "search the workspace",
      subagentType: "Explore",
    });
  });

  test("drops mistyped fields and tolerates non-objects", () => {
    expect(narrowAgentInput({ description: 42, subagent_type: ["x"] })).toEqual({
      description: undefined,
      prompt: undefined,
      subagentType: undefined,
    });
    expect(narrowAgentInput(null)).toEqual({});
    expect(narrowAgentInput("nope")).toEqual({});
    expect(narrowAgentInput(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// narrowAgentStructured
// ---------------------------------------------------------------------------

describe("narrowAgentStructured", () => {
  test("narrows the text-only fixture", () => {
    const result = narrowAgentStructured(TEXT_ONLY_FIXTURE);
    expect(result.agentType).toBe("Explore");
    expect(result.status).toBe("completed");
    expect(result.content?.length).toBe(1);
    expect(result.totalDurationMs).toBe(3566);
    expect(result.totalTokens).toBe(15700);
    expect(result.totalToolUseCount).toBe(1);
  });

  test("a missing or mistyped content array narrows to undefined", () => {
    expect(narrowAgentStructured({ agentType: "Explore" }).content).toBeUndefined();
    expect(narrowAgentStructured({ content: "nope" }).content).toBeUndefined();
  });

  test("tolerates non-objects", () => {
    expect(narrowAgentStructured(null)).toEqual({});
    expect(narrowAgentStructured("nope")).toEqual({});
    expect(narrowAgentStructured(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// composeAgentTranscriptData
// ---------------------------------------------------------------------------

describe("composeAgentTranscriptData", () => {
  test("composes the text-only fixture into a text entry + metadata", () => {
    const data = composeAgentTranscriptData(
      {},
      narrowAgentStructured(TEXT_ONLY_FIXTURE),
    );
    expect(data).toBeDefined();
    if (data === undefined) throw new Error("unreachable");
    expect(data.agentType).toBe("Explore");
    expect(data.status).toBe("completed");
    expect(data.durationMs).toBe(3566);
    expect(data.toolUseCount).toBe(1);
    expect(data.totalTokens).toBe(15700);
    expect(data.entries).toEqual([
      { kind: "text", text: "src/feed.rs\nsrc/lib.rs" },
    ]);
  });

  test("narrows a nested tool_use content block into a tool_use entry", () => {
    const data = composeAgentTranscriptData(
      {},
      narrowAgentStructured(NESTED_GREP_FIXTURE),
    );
    expect(data?.entries.map((e) => e.kind)).toEqual([
      "text",
      "tool_use",
      "text",
    ]);
    const toolEntry = data?.entries[1];
    if (toolEntry?.kind !== "tool_use") throw new Error("unreachable");
    expect(toolEntry.toolCall.toolName).toBe("Grep");
    expect(toolEntry.toolCall.toolUseId).toBe("tu-grep-1");
    expect(toolEntry.toolCall.input).toEqual({
      pattern: "FeedId",
      path: "/repo",
    });
    // No result yet — a content-block tool_use renders as a done call.
    expect(toolEntry.toolCall.status).toBe("done");
  });

  test("drops junk content blocks (bad type, missing id / name)", () => {
    const data = composeAgentTranscriptData(
      {},
      narrowAgentStructured({
        content: [
          { type: "text", text: "kept" },
          { type: "image", url: "x" }, // unsupported block type → dropped
          { type: "tool_use", name: "Grep" }, // missing id → dropped
          { type: "tool_use", id: "tu-2" }, // missing name → dropped
          null,
          42,
        ],
      }),
    );
    expect(data?.entries).toEqual([{ kind: "text", text: "kept" }]);
  });

  test("agentType falls back to the input's subagent_type", () => {
    const data = composeAgentTranscriptData(
      { subagentType: "Plan" },
      narrowAgentStructured({ content: [], status: "in_progress" }),
    );
    expect(data?.agentType).toBe("Plan");
    expect(data?.status).toBe("in_progress");
    expect(data?.entries).toEqual([]);
  });

  test("an entirely empty structured result composes undefined", () => {
    expect(composeAgentTranscriptData({}, {})).toBeUndefined();
    expect(
      composeAgentTranscriptData({}, narrowAgentStructured(null)),
    ).toBeUndefined();
  });

  test("merges reducer-linked child tool calls ahead of the wire content", () => {
    // [#step-17-5]: a subagent's intermediate tool calls (linked by
    // the reducer via `parentToolUseId`) render first; its final text
    // answer (the wire `content[]`) follows.
    const data = composeAgentTranscriptData(
      {},
      narrowAgentStructured(TEXT_ONLY_FIXTURE),
      [childCall("grep-1", "Grep"), childCall("read-1", "Read")],
    );
    expect(data?.entries.map((e) => e.kind)).toEqual([
      "tool_use",
      "tool_use",
      "text",
    ]);
    const first = data?.entries[0];
    const second = data?.entries[1];
    if (first?.kind !== "tool_use" || second?.kind !== "tool_use") {
      throw new Error("unreachable");
    }
    expect(first.toolCall.toolName).toBe("Grep");
    expect(second.toolCall.toolName).toBe("Read");
  });

  test("child tool calls alone compose a transcript (no wire content)", () => {
    const data = composeAgentTranscriptData({ subagentType: "Explore" }, {}, [
      childCall("grep-1", "Grep"),
    ]);
    expect(data).toBeDefined();
    if (data === undefined) throw new Error("unreachable");
    expect(data.agentType).toBe("Explore");
    expect(data.entries.map((e) => e.kind)).toEqual(["tool_use"]);
  });
});

// ---------------------------------------------------------------------------
// Dispatch routing — Agent / Task → TaskToolBlock
// ---------------------------------------------------------------------------

describe("Agent dispatch routing", () => {
  test("resolveToolWrapper routes Agent (and the Task alias) to TaskToolBlock", () => {
    _resetToolWrapperRegistryForTests();
    registerToolWrapper("agent", TaskToolBlock);
    expect(resolveToolWrapper("agent")).toBe(TaskToolBlock);
    expect(resolveToolWrapper("Agent")).toBe(TaskToolBlock);
    expect(resolveToolWrapper("AGENT")).toBe(TaskToolBlock);
    // The historical `Task` name resolves via the `task → agent` alias.
    expect(resolveToolWrapper("Task")).toBe(TaskToolBlock);
    expect(resolveToolWrapper("task")).toBe(TaskToolBlock);
  });
});

// ---------------------------------------------------------------------------
// [D17] recursion — nested tool calls dispatch at depth + 1
// ---------------------------------------------------------------------------

describe("synthetic Grep-in-subagent fixture — nested call routes via GrepToolBlock", () => {
  test("a nested Grep tool_use entry dispatches to GrepToolBlock at depth + 1", () => {
    _resetToolWrapperRegistryForTests();
    registerToolWrapper("grep", GrepToolBlock);
    registerToolWrapper("agent", TaskToolBlock);

    const data = composeAgentTranscriptData(
      {},
      narrowAgentStructured(NESTED_GREP_FIXTURE),
    );
    const toolEntry = data?.entries[1];
    if (toolEntry?.kind !== "tool_use") throw new Error("unreachable");

    // AgentTranscriptBlock at depth 0 dispatches its nested calls at
    // depth + 1.
    const result = dispatchToolCallState(toolEntry.toolCall, "msg-17", 1);
    expect(result.Component).toBe(GrepToolBlock);
    expect(result.props.depth).toBe(1);
  });
});

describe("synthetic depth fixture — depth-3 renders, depth-4 collapses", () => {
  test("a nested Agent entry dispatches to TaskToolBlock carrying the deeper depth", () => {
    _resetToolWrapperRegistryForTests();
    registerToolWrapper("agent", TaskToolBlock);

    const data = composeAgentTranscriptData(
      {},
      narrowAgentStructured(NESTED_AGENT_FIXTURE),
    );
    const toolEntry = data?.entries[0];
    if (toolEntry?.kind !== "tool_use") throw new Error("unreachable");

    // A depth-3 AgentTranscriptBlock dispatches its nested Agent at
    // depth 4 — the nested TaskToolBlock carries `depth: 4`.
    const result = dispatchToolCallState(toolEntry.toolCall, "msg-17", 4);
    expect(result.Component).toBe(TaskToolBlock);
    expect(result.props.depth).toBe(4);
  });

  test("the depth cap renders depth-3 expanded and collapses depth-4", () => {
    // AGENT_MAX_DEPTH is 3: a depth-3 transcript renders expanded, a
    // depth-4 one starts collapsed behind the "+N nested calls" cue.
    expect(AGENT_MAX_DEPTH).toBe(3);
    expect(shouldCollapseAgentDepth(3)).toBe(false);
    expect(shouldCollapseAgentDepth(4)).toBe(true);
  });
});
