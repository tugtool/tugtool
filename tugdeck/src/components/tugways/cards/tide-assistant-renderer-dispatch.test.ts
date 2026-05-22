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

import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import React from "react";

import {
  KIND_RENDERERS,
  VALIDATED_CC_VERSION,
  _resetDriftLogForTests,
  _resetToolWrapperRegistryForTests,
  checkStructuredShape,
  detectToolCallDrift,
  detectVersionDrift,
  dispatch,
  dispatchToolCallState,
  extractMetadataVersion,
  logDriftEvent,
  registerToolWrapper,
  registeredTools,
  resolveToolWrapper,
  summarizeDrift,
  versionDriftCaution,
  versionLine,
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
    toolWallMs: null,
    ...overrides,
  };
}

/** Stable identity for "the canonical Edit wrapper" used by alias tests. */
const FakeEditWrapper: React.FC<ToolWrapperProps> = () =>
  React.createElement("div", { "data-slot": "fake-edit" });
FakeEditWrapper.displayName = "FakeEditWrapper";

beforeEach(() => {
  _resetToolWrapperRegistryForTests();
  _resetDriftLogForTests();
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

// ---------------------------------------------------------------------------
// Drift detection — shallow structured-result shape check
// ---------------------------------------------------------------------------

describe("checkStructuredShape", () => {
  it("returns null when every required field is present and well-typed", () => {
    expect(checkStructuredShape({ file: {} }, { file: "object" })).toBeNull();
    expect(
      checkStructuredShape(
        { file: { content: "x" }, type: "text" },
        { file: "object" },
      ),
    ).toBeNull();
  });

  it("reports a missing required field", () => {
    expect(checkStructuredShape({ type: "text" }, { file: "object" })).toBe(
      "file: missing",
    );
  });

  it("reports a wrong-typed field, naming the actual type", () => {
    expect(checkStructuredShape({ file: "x" }, { file: "object" })).toBe(
      "file: expected object, got string",
    );
    // An array is not an `object` (the schema's "object" excludes arrays).
    expect(checkStructuredShape({ file: [] }, { file: "object" })).toBe(
      "file: expected object, got array",
    );
    // `null` is reported distinctly from a plain object.
    expect(checkStructuredShape({ file: null }, { file: "object" })).toBe(
      "file: expected object, got null",
    );
  });

  it("checks the `array` type via Array.isArray", () => {
    expect(checkStructuredShape({ items: [] }, { items: "array" })).toBeNull();
    expect(checkStructuredShape({ items: {} }, { items: "array" })).toBe(
      "items: expected array, got object",
    );
  });

  it("returns the first mismatch across a multi-field schema", () => {
    const schema = { file: "object", type: "string" } as const;
    expect(checkStructuredShape({ type: "text" }, schema)).toBe("file: missing");
    expect(checkStructuredShape({ file: {}, type: 42 }, schema)).toBe(
      "type: expected string, got number",
    );
  });
});

// ---------------------------------------------------------------------------
// Drift detection — version drift
// ---------------------------------------------------------------------------

describe("extractMetadataVersion", () => {
  it("pulls a string `version` from a metadata object", () => {
    expect(extractMetadataVersion({ version: "2.1.105" })).toBe("2.1.105");
  });

  it("returns null for a non-string version or a non-object payload", () => {
    expect(extractMetadataVersion({ version: 42 })).toBeNull();
    expect(extractMetadataVersion({})).toBeNull();
    expect(extractMetadataVersion(null)).toBeNull();
    expect(extractMetadataVersion("system_metadata")).toBeNull();
  });
});

describe("versionLine", () => {
  it("reduces a version to its major.minor line", () => {
    expect(versionLine("2.1.148")).toBe("2.1");
    expect(versionLine("2.1.105")).toBe("2.1");
    expect(versionLine("2.2.0")).toBe("2.2");
    expect(versionLine("3.0.17")).toBe("3.0");
  });

  it("returns a sub-two-segment version whole", () => {
    expect(versionLine("2")).toBe("2");
    expect(versionLine("")).toBe("");
  });
});

describe("versionDriftCaution", () => {
  it("returns null when the version is on the validated minor line", () => {
    expect(versionDriftCaution(VALIDATED_CC_VERSION)).toBeNull();
  });

  it("returns null for a patch difference within the validated line", () => {
    // The validated baseline is a `2.1.x` line; a different patch on
    // the same line is normal daily churn, not drift.
    const samePatchLine = `${versionLine(VALIDATED_CC_VERSION)}.99999`;
    expect(versionDriftCaution(samePatchLine)).toBeNull();
  });

  it("returns null when no version has been captured yet", () => {
    expect(versionDriftCaution(null)).toBeNull();
  });

  it("flags a version on a different minor line, both versions in the detail", () => {
    expect(versionDriftCaution("2.2.0")).toEqual({
      reason: "version_drift",
      detail: `2.2.0 ≠ ${VALIDATED_CC_VERSION}`,
    });
  });
});

describe("detectVersionDrift", () => {
  it("flags a `system_metadata` payload on a different minor line", () => {
    expect(detectVersionDrift({ version: "2.2.0" })).toEqual({
      reason: "version_drift",
      detail: `2.2.0 ≠ ${VALIDATED_CC_VERSION}`,
    });
  });

  it("returns null for a same-line version or a versionless payload", () => {
    expect(detectVersionDrift({ version: VALIDATED_CC_VERSION })).toBeNull();
    expect(
      detectVersionDrift({ version: `${versionLine(VALIDATED_CC_VERSION)}.0` }),
    ).toBeNull();
    expect(detectVersionDrift({})).toBeNull();
    expect(detectVersionDrift(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Drift detection — per-tool-call detector
// ---------------------------------------------------------------------------

describe("detectToolCallDrift", () => {
  it("flags an unknown tool name", () => {
    expect(detectToolCallDrift(fakeToolCall("ZzzUnknown"))).toEqual({
      reason: "unknown_tool",
      detail: "ZzzUnknown",
    });
  });

  it("does not flag an audit-confirmed default-routed tool", () => {
    expect(detectToolCallDrift(fakeToolCall("TaskUpdate"))).toBeNull();
  });

  it("does not flag a registered wrapper with no shape schema", () => {
    registerToolWrapper("edit", FakeEditWrapper);
    expect(detectToolCallDrift(fakeToolCall("Edit"))).toBeNull();
  });

  it("does not flag a registered Read with a well-shaped structured result", () => {
    registerToolWrapper("read", FakeEditWrapper);
    expect(
      detectToolCallDrift(
        fakeToolCall("Read", { structuredResult: { file: { content: "x" } } }),
      ),
    ).toBeNull();
  });

  it("flags a registered Read whose structured result fails the shape schema", () => {
    registerToolWrapper("read", FakeEditWrapper);
    expect(
      detectToolCallDrift(
        fakeToolCall("Read", { structuredResult: { type: "text" } }),
      ),
    ).toEqual({ reason: "unknown_shape", detail: "Read: file: missing" });
  });

  it("does not shape-check an absent (null) structured result — that is the streaming window", () => {
    registerToolWrapper("read", FakeEditWrapper);
    expect(
      detectToolCallDrift(fakeToolCall("Read", { structuredResult: null })),
    ).toBeNull();
  });

  it("does not shape-check an errored tool call — an error result is allowed to diverge", () => {
    registerToolWrapper("read", FakeEditWrapper);
    expect(
      detectToolCallDrift(
        fakeToolCall("Read", {
          status: "error",
          structuredResult: { type: "text" },
        }),
      ),
    ).toBeNull();
  });

  it("treats an unregistered Read as unknown_tool, not unknown_shape", () => {
    // `read` is not in the registry (reset in beforeEach) — a registry
    // miss is unknown_tool; the shape schema only governs registered tools.
    expect(
      detectToolCallDrift(
        fakeToolCall("Read", { structuredResult: { type: "text" } }),
      ),
    ).toEqual({ reason: "unknown_tool", detail: "Read" });
  });
});

// ---------------------------------------------------------------------------
// Drift detection — dispatch wiring (shape drift + version drift)
// ---------------------------------------------------------------------------

describe("dispatch — shape drift routing", () => {
  it("routes a registered Read with a bad structured shape to DefaultToolWrapper + caution", () => {
    registerToolWrapper("read", FakeEditWrapper);
    const input: RenderInput = {
      kind: "tool_call",
      toolCall: fakeToolCall("Read", { structuredResult: { file: 42 } }),
      msgId: "m1",
    };
    const result = dispatch(input, fakeContext);
    expect(result.Component).toBe(DefaultToolWrapper);
    expect(result.caution).toEqual({
      reason: "unknown_shape",
      detail: "Read: file: expected object, got number",
    });
    // The caution is threaded onto the props so the chrome paints the
    // inline `TideCautionBadge`.
    expect((result.props as { caution?: unknown }).caution).toEqual(
      result.caution,
    );
  });

  it("routes a registered Read with a good structured shape to its bespoke wrapper", () => {
    registerToolWrapper("read", FakeEditWrapper);
    const result = dispatchToolCallState(
      fakeToolCall("Read", { structuredResult: { file: { content: "x" } } }),
      "m1",
    );
    expect(result.Component).toBe(FakeEditWrapper);
    expect(result.caution).toBeUndefined();
  });
});

describe("dispatch — system_metadata version drift", () => {
  it("raises a version_drift caution for a different-minor system_metadata version", () => {
    const input: RenderInput = {
      kind: "system_metadata",
      metadata: { type: "system_metadata", version: "2.2.0" },
    };
    const result = dispatch(input, fakeContext);
    expect(result.Component).toBe(KIND_RENDERERS.system_metadata);
    expect(result.caution).toEqual({
      reason: "version_drift",
      detail: `2.2.0 ≠ ${VALIDATED_CC_VERSION}`,
    });
    // Threaded onto props so the #step-29 SessionInitBanner can paint
    // the inline marker.
    expect((result.props as { caution?: unknown }).caution).toEqual(
      result.caution,
    );
  });

  it("raises no caution for a version on the validated minor line", () => {
    const input: RenderInput = {
      kind: "system_metadata",
      metadata: {
        type: "system_metadata",
        version: `${versionLine(VALIDATED_CC_VERSION)}.0`,
      },
    };
    const result = dispatch(input, fakeContext);
    expect(result.caution).toBeUndefined();
    expect((result.props as { caution?: unknown }).caution).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Drift detection — transcript-wide aggregate
// ---------------------------------------------------------------------------

describe("summarizeDrift", () => {
  it("returns a zero summary for a clean transcript", () => {
    registerToolWrapper("edit", FakeEditWrapper);
    expect(
      summarizeDrift({
        toolCalls: [fakeToolCall("Edit")],
        version: VALIDATED_CC_VERSION,
      }),
    ).toEqual({ count: 0, events: [] });
  });

  it("counts tool-call drift and version drift across the session", () => {
    registerToolWrapper("edit", FakeEditWrapper);
    registerToolWrapper("read", FakeEditWrapper);
    const summary = summarizeDrift({
      toolCalls: [
        fakeToolCall("ZzzUnknown", { toolUseId: "tu-a" }),
        fakeToolCall("Edit", { toolUseId: "tu-b" }),
        fakeToolCall("Read", {
          toolUseId: "tu-c",
          structuredResult: { type: "text" },
        }),
      ],
      version: "2.2.0",
    });
    expect(summary.count).toBe(3);
    // Tool drift in transcript order, version drift appended last.
    expect(summary.events.map((e) => e.caution.reason)).toEqual([
      "unknown_tool",
      "unknown_shape",
      "version_drift",
    ]);
    expect(summary.events[0]).toMatchObject({
      toolName: "ZzzUnknown",
      toolUseId: "tu-a",
    });
    expect(summary.events[2]).toMatchObject({ version: "2.2.0" });
  });

  it("omits version drift on the validated minor line or an absent version", () => {
    expect(summarizeDrift({ toolCalls: [], version: null }).count).toBe(0);
    expect(
      summarizeDrift({ toolCalls: [], version: VALIDATED_CC_VERSION }).count,
    ).toBe(0);
    expect(
      summarizeDrift({
        toolCalls: [],
        version: `${versionLine(VALIDATED_CC_VERSION)}.0`,
      }).count,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Drift detection — triage logging
// ---------------------------------------------------------------------------

describe("logDriftEvent", () => {
  it("logs a drift event once, with reason / toolName / version / summary", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      logDriftEvent({
        caution: { reason: "unknown_tool", detail: "ZzzUnknown" },
        toolName: "ZzzUnknown",
        toolUseId: "tu-1",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[1]).toEqual({
        reason: "unknown_tool",
        toolName: "ZzzUnknown",
        version: undefined,
        summary: "ZzzUnknown",
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("dedupes a repeated drift occurrence — logged once, not on every re-detect", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const event = {
        caution: { reason: "unknown_shape" as const, detail: "Read: file: missing" },
        toolName: "Read",
        toolUseId: "tu-7",
      };
      logDriftEvent(event);
      logDriftEvent(event);
      logDriftEvent(event);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("logs version drift keyed on the version string", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      logDriftEvent({
        caution: { reason: "version_drift", detail: `2.2.0 ≠ ${VALIDATED_CC_VERSION}` },
        version: "2.2.0",
      });
      logDriftEvent({
        caution: { reason: "version_drift", detail: `2.2.0 ≠ ${VALIDATED_CC_VERSION}` },
        version: "2.2.0",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[1]).toMatchObject({
        reason: "version_drift",
        version: "2.2.0",
      });
    } finally {
      warn.mockRestore();
    }
  });
});
