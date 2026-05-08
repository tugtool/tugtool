/**
 * Unit tests for `tide-assistant-renderer-dispatch.ts` — the routing
 * layer that maps a `RenderInput` to a renderer component + props.
 *
 * The dispatch is pure over a module-static registry. Each test
 * resets the registry to a known empty state, then exercises one
 * branch of the routing logic.
 *
 * Coverage:
 *  - assistant_text routes to the kind-level scaffold (today; replaced
 *    in #step-3 by the real assistant-turn renderer).
 *  - tool_call with an unknown name routes to DefaultToolWrapper with
 *    a caution flag.
 *  - tool_call with an alias (`MultiEdit` / `multiedit` / `MULTIEDIT`)
 *    resolves to the canonical wrapper.
 *  - tool_call lookup is case-insensitive on the tool name.
 *  - audit-confirmed default-routed tools resolve to DefaultToolWrapper
 *    *without* a caution flag (they are known to default-route by
 *    design).
 *  - registeredTools() reports the registry's coverage.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import React from "react";

import {
  KIND_RENDERERS,
  _resetToolWrapperRegistryForTests,
  dispatch,
  registerToolWrapper,
  registeredTools,
  resolveToolWrapper,
  type DispatchContext,
  type RenderInput,
} from "./tide-assistant-renderer-dispatch";
import { DefaultToolWrapper } from "./tool-wrappers/default-tool-wrapper";
import type { ToolWrapperProps } from "./tool-wrappers/types";
import type { ToolCallState } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Test-local fakes
// ---------------------------------------------------------------------------

/**
 * Minimal context stub. The dispatch logic doesn't dereference the
 * fields in any of the routes exercised here (registry lookup is the
 * only side effect), so a typed `unknown` cast is sufficient.
 */
const fakeContext = {} as DispatchContext;

function fakeToolCall(toolName: string, overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    toolUseId: "tu-1",
    toolName,
    input: {},
    status: "done",
    result: null,
    structuredResult: null,
    ...overrides,
  };
}

/** Stable identity for "the canonical Edit wrapper" used by alias tests. */
const FakeEditWrapper: React.FC<ToolWrapperProps> = () =>
  React.createElement("div", { "data-slot": "fake-edit" });
FakeEditWrapper.displayName = "FakeEditWrapper";

beforeEach(() => {
  _resetToolWrapperRegistryForTests();
});

// ---------------------------------------------------------------------------
// dispatch() — kind routing
// ---------------------------------------------------------------------------

describe("dispatch — kind routing", () => {
  it("routes assistant_text to KIND_RENDERERS.assistant_text", () => {
    const input: RenderInput = {
      kind: "assistant_text",
      text: "Hello",
      status: "complete",
      msgId: "m1",
    };
    const result = dispatch(input, fakeContext);
    expect(result.Component).toBe(KIND_RENDERERS.assistant_text);
    expect(result.caution).toBeUndefined();
  });

  it("routes thinking to KIND_RENDERERS.thinking", () => {
    const input: RenderInput = {
      kind: "thinking",
      text: "...",
      status: "complete",
      msgId: "m1",
    };
    expect(dispatch(input, fakeContext).Component).toBe(KIND_RENDERERS.thinking);
  });

  it("routes permission to KIND_RENDERERS.permission", () => {
    const input: RenderInput = {
      kind: "permission",
      request: {
        request_id: "r1",
        is_question: false,
      },
    };
    expect(dispatch(input, fakeContext).Component).toBe(KIND_RENDERERS.permission);
  });

  it("routes question to KIND_RENDERERS.question (separate from permission)", () => {
    const input: RenderInput = {
      kind: "question",
      request: {
        request_id: "r2",
        is_question: true,
      },
    };
    expect(dispatch(input, fakeContext).Component).toBe(KIND_RENDERERS.question);
    expect(KIND_RENDERERS.question).not.toBe(KIND_RENDERERS.permission);
  });
});

// ---------------------------------------------------------------------------
// dispatch() — tool_call routing
// ---------------------------------------------------------------------------

describe("dispatch — tool_call routing", () => {
  it("routes a known tool to its registered wrapper, no caution", () => {
    registerToolWrapper("edit", FakeEditWrapper);
    const input: RenderInput = {
      kind: "tool_call",
      toolCall: fakeToolCall("Edit"),
      msgId: "m1",
    };
    const result = dispatch(input, fakeContext);
    expect(result.Component).toBe(FakeEditWrapper);
    expect(result.caution).toBeUndefined();
  });

  it("routes an unknown tool to DefaultToolWrapper with caution.reason='unknown_tool'", () => {
    const input: RenderInput = {
      kind: "tool_call",
      toolCall: fakeToolCall("ZzzUnknownTool"),
      msgId: "m1",
    };
    const result = dispatch(input, fakeContext);
    expect(result.Component).toBe(DefaultToolWrapper);
    expect(result.caution).toEqual({
      reason: "unknown_tool",
      detail: "ZzzUnknownTool",
    });
    // The caution is also threaded into props so the wrapper can render
    // its inline badge.
    expect((result.props as { caution?: unknown }).caution).toEqual({
      reason: "unknown_tool",
      detail: "ZzzUnknownTool",
    });
  });

  it("routes audit-confirmed default tools to DefaultToolWrapper without caution", () => {
    const input: RenderInput = {
      kind: "tool_call",
      toolCall: fakeToolCall("TaskUpdate"),
      msgId: "m1",
    };
    const result = dispatch(input, fakeContext);
    expect(result.Component).toBe(DefaultToolWrapper);
    expect(result.caution).toBeUndefined();
  });

  it("threads tool fields onto the wrapper props", () => {
    registerToolWrapper("edit", FakeEditWrapper);
    const input: RenderInput = {
      kind: "tool_call",
      toolCall: fakeToolCall("Edit", {
        toolUseId: "tu-42",
        input: { file_path: "/x.ts", old_string: "a", new_string: "b" },
        status: "done",
      }),
      msgId: "msg-7",
    };
    const result = dispatch(input, fakeContext);
    const props = result.props as Record<string, unknown>;
    expect(props.toolUseId).toBe("tu-42");
    expect(props.toolName).toBe("Edit");
    expect(props.msgId).toBe("msg-7");
    expect(props.status).toBe("ready");
    expect(props.isError).toBe(false);
    expect(props.input).toEqual({
      file_path: "/x.ts",
      old_string: "a",
      new_string: "b",
    });
  });

  it("maps store status pending → wrapper status streaming", () => {
    registerToolWrapper("bash", FakeEditWrapper);
    const input: RenderInput = {
      kind: "tool_call",
      toolCall: fakeToolCall("Bash", { status: "pending" }),
      msgId: "m1",
    };
    const props = dispatch(input, fakeContext).props as { status: string };
    expect(props.status).toBe("streaming");
  });

  it("maps store status error → wrapper status error and isError=true", () => {
    registerToolWrapper("bash", FakeEditWrapper);
    const input: RenderInput = {
      kind: "tool_call",
      toolCall: fakeToolCall("Bash", { status: "error" }),
      msgId: "m1",
    };
    const props = dispatch(input, fakeContext).props as {
      status: string;
      isError: boolean;
    };
    expect(props.status).toBe("error");
    expect(props.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveToolWrapper — alias and case-insensitive lookup
// ---------------------------------------------------------------------------

describe("resolveToolWrapper", () => {
  it("returns DefaultToolWrapper for an empty registry", () => {
    expect(resolveToolWrapper("Anything")).toBe(DefaultToolWrapper);
  });

  it("looks up by exact lowercase name", () => {
    registerToolWrapper("read", FakeEditWrapper);
    expect(resolveToolWrapper("read")).toBe(FakeEditWrapper);
  });

  it("is case-insensitive on the input name", () => {
    registerToolWrapper("read", FakeEditWrapper);
    expect(resolveToolWrapper("Read")).toBe(FakeEditWrapper);
    expect(resolveToolWrapper("READ")).toBe(FakeEditWrapper);
    expect(resolveToolWrapper("reAd")).toBe(FakeEditWrapper);
  });

  it("resolves the multiedit → edit alias", () => {
    registerToolWrapper("edit", FakeEditWrapper);
    expect(resolveToolWrapper("MultiEdit")).toBe(FakeEditWrapper);
    expect(resolveToolWrapper("multiedit")).toBe(FakeEditWrapper);
    expect(resolveToolWrapper("MULTIEDIT")).toBe(FakeEditWrapper);
  });

  it("resolves the task → agent alias (historical rename)", () => {
    const FakeAgent: React.FC<ToolWrapperProps> = () =>
      React.createElement("div");
    FakeAgent.displayName = "FakeAgent";
    registerToolWrapper("agent", FakeAgent);
    expect(resolveToolWrapper("Task")).toBe(FakeAgent);
    expect(resolveToolWrapper("task")).toBe(FakeAgent);
    expect(resolveToolWrapper("Agent")).toBe(FakeAgent);
  });

  it("falls back to DefaultToolWrapper when an alias's canonical isn't registered", () => {
    // multiedit aliases to edit, but edit isn't in the registry yet.
    expect(resolveToolWrapper("MultiEdit")).toBe(DefaultToolWrapper);
  });
});

// ---------------------------------------------------------------------------
// registeredTools — coverage enumeration
// ---------------------------------------------------------------------------

describe("registeredTools", () => {
  it("returns an empty array for an empty registry", () => {
    expect(registeredTools()).toEqual([]);
  });

  it("returns canonical (lowercased) names, sorted, no aliases", () => {
    registerToolWrapper("Edit", FakeEditWrapper);
    registerToolWrapper("read", FakeEditWrapper);
    registerToolWrapper("bash", FakeEditWrapper);
    expect(registeredTools()).toEqual(["bash", "edit", "read"]);
  });

  it("does not include DefaultToolWrapper or aliases", () => {
    registerToolWrapper("agent", FakeEditWrapper);
    // `task` is an alias for `agent`; should not appear.
    const names = registeredTools();
    expect(names).toEqual(["agent"]);
    expect(names).not.toContain("task");
  });
});
