/**
 * Pure-logic tests for `AgentTranscriptBlock`'s exported helpers.
 *
 * `AgentTranscriptBlock` is decoration over composition (a header /
 * entry-column / footer that routes nested tool calls back through
 * `dispatchToolCallState`) — its behaviour *is* these pure helpers:
 *
 *  - `shouldCollapseAgentDepth` — the [D17] depth cap that bounds
 *    auto-expansion of nested subagent transcripts.
 *  - `countNestedToolCalls` / `composeNestedCallsLabel` — the
 *    fold-cue's "+N nested calls" label.
 *  - `composeAgentToolCountLabel` / `composeAgentDurationLabel` /
 *    `composeAgentTokenLabel` — the header / footer annotations.
 *  - `composeAgentTranscriptText` — the Copy affordance's
 *    serialization.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions.
 */

import { describe, expect, test } from "bun:test";

import {
  AGENT_MAX_DEPTH,
  composeAgentDurationLabel,
  composeAgentTokenLabel,
  composeAgentToolCountLabel,
  composeAgentTranscriptText,
  composeNestedCallsLabel,
  countNestedToolCalls,
  shouldCollapseAgentDepth,
  type AgentTranscriptData,
} from "../agent-transcript-block";
import type { ToolUseMessage } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function toolEntry(toolName: string, toolUseId: string) {
  const toolCall: ToolUseMessage = {
    kind: "tool_use",
    messageKey: `fixture-${toolUseId}`,
    createdAt: 0,
    toolUseId,
    toolName,
    input: {},
    status: "done",
    result: null,
    structuredResult: null,
    toolWallMs: null,
  };
  return { kind: "tool_use" as const, toolCall };
}

const DATA: AgentTranscriptData = {
  agentType: "Explore",
  status: "completed",
  durationMs: 3566,
  toolUseCount: 1,
  totalTokens: 15700,
  entries: [
    { kind: "text", text: "Found the references:" },
    toolEntry("Grep", "tu-grep-1"),
    { kind: "text", text: "src/feed.rs\nsrc/lib.rs" },
  ],
};

// ---------------------------------------------------------------------------
// shouldCollapseAgentDepth
// ---------------------------------------------------------------------------

describe("shouldCollapseAgentDepth", () => {
  test("depth at or under the cap renders expanded", () => {
    expect(shouldCollapseAgentDepth(0)).toBe(false);
    expect(shouldCollapseAgentDepth(1)).toBe(false);
    expect(shouldCollapseAgentDepth(2)).toBe(false);
    expect(shouldCollapseAgentDepth(AGENT_MAX_DEPTH)).toBe(false);
  });

  test("depth past the cap starts collapsed", () => {
    expect(shouldCollapseAgentDepth(AGENT_MAX_DEPTH + 1)).toBe(true);
    expect(shouldCollapseAgentDepth(10)).toBe(true);
  });

  test("the cap is configurable", () => {
    expect(shouldCollapseAgentDepth(2, 1)).toBe(true);
    expect(shouldCollapseAgentDepth(1, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// countNestedToolCalls / composeNestedCallsLabel
// ---------------------------------------------------------------------------

describe("countNestedToolCalls", () => {
  test("counts only the tool_use entries", () => {
    expect(countNestedToolCalls(DATA)).toBe(1);
  });

  test("a text-only transcript has zero nested calls", () => {
    expect(
      countNestedToolCalls({ entries: [{ kind: "text", text: "hi" }] }),
    ).toBe(0);
  });
});

describe("composeNestedCallsLabel", () => {
  test("pluralizes on the count", () => {
    expect(composeNestedCallsLabel(0)).toBe("0 nested calls");
    expect(composeNestedCallsLabel(1)).toBe("1 nested call");
    expect(composeNestedCallsLabel(4)).toBe("4 nested calls");
  });
});

// ---------------------------------------------------------------------------
// composeAgentToolCountLabel
// ---------------------------------------------------------------------------

describe("composeAgentToolCountLabel", () => {
  test("pluralizes on the count", () => {
    expect(composeAgentToolCountLabel(0)).toBe("0 tool calls");
    expect(composeAgentToolCountLabel(1)).toBe("1 tool call");
    expect(composeAgentToolCountLabel(5)).toBe("5 tool calls");
  });

  test("undefined count yields no label", () => {
    expect(composeAgentToolCountLabel(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// composeAgentDurationLabel
// ---------------------------------------------------------------------------

describe("composeAgentDurationLabel", () => {
  test("sub-second durations render in milliseconds", () => {
    expect(composeAgentDurationLabel(0)).toBe("0 ms");
    expect(composeAgentDurationLabel(850)).toBe("850 ms");
  });

  test("seconds get one decimal under 10s, none above", () => {
    expect(composeAgentDurationLabel(3566)).toBe("3.6 s");
    expect(composeAgentDurationLabel(45_000)).toBe("45 s");
  });

  test("minute-plus durations render as Mm SSs", () => {
    expect(composeAgentDurationLabel(125_000)).toBe("2m 05s");
  });

  test("undefined / invalid durations yield no label", () => {
    expect(composeAgentDurationLabel(undefined)).toBeUndefined();
    expect(composeAgentDurationLabel(-1)).toBeUndefined();
    expect(composeAgentDurationLabel(Number.NaN)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// composeAgentTokenLabel
// ---------------------------------------------------------------------------

describe("composeAgentTokenLabel", () => {
  test("formats with locale grouping", () => {
    expect(composeAgentTokenLabel(0)).toBe("0 tokens");
    expect(composeAgentTokenLabel(15_700)).toBe("15,700 tokens");
  });

  test("undefined / invalid token counts yield no label", () => {
    expect(composeAgentTokenLabel(undefined)).toBeUndefined();
    expect(composeAgentTokenLabel(-5)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// composeAgentTranscriptText
// ---------------------------------------------------------------------------

describe("composeAgentTranscriptText", () => {
  test("serializes an identity line then each entry", () => {
    expect(composeAgentTranscriptText(DATA)).toBe(
      [
        "Explore · completed",
        "Found the references:",
        "[tool: Grep]",
        "src/feed.rs\nsrc/lib.rs",
      ].join("\n"),
    );
  });

  test("omits the identity line when there is no agent type or status", () => {
    expect(
      composeAgentTranscriptText({ entries: [{ kind: "text", text: "hi" }] }),
    ).toBe("hi");
  });
});
