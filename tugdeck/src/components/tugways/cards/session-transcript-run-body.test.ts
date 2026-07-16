/**
 * Unit tests for `session-transcript-run-body.ts` — the classifier that
 * decides whether an assistant run paints user-facing content and, when
 * it doesn't, which fallback (plumbing marker vs. empty placeholder) the
 * body renderer substitutes for the blank body.
 *
 * Pure over the tool-visibility policy. `ScheduleWakeup` / `ToolSearch`
 * are `hidden`-policy tools (resolve to `NullToolBlock`); `Bash` is a
 * visible tool. `resolveToolBlock`'s hidden check reads the static
 * policy ahead of the registry, so no registration side-effect is
 * needed here.
 */

import { describe, it, expect } from "bun:test";

import type {
  Message,
  AssistantText,
  AssistantThinking,
  ToolUseMessage,
} from "@/lib/code-session-store";

import { classifyRunBody } from "./session-transcript-run-body";

let seq = 0;
function text(value: string): AssistantText {
  return { kind: "assistant_text", messageKey: `t-${seq++}`, createdAt: 0, text: value };
}
function thinking(value: string): AssistantThinking {
  return {
    kind: "assistant_thinking",
    messageKey: `th-${seq++}`,
    createdAt: 0,
    text: value,
  };
}
function tool(toolName: string, overrides: Partial<ToolUseMessage> = {}): ToolUseMessage {
  return {
    kind: "tool_use",
    messageKey: `tu-${seq++}`,
    createdAt: 0,
    toolUseId: `id-${seq}`,
    toolName,
    input: {},
    status: "done",
    result: null,
    structuredResult: null,
    toolWallMs: null,
    ...overrides,
  };
}

function run(...messages: Message[]): Message[] {
  return messages;
}

describe("classifyRunBody", () => {
  it("returns `none` for a run with non-empty assistant text", () => {
    expect(classifyRunBody(run(text("hello")))).toEqual({
      fallback: "none",
      markers: [],
    });
  });

  it("returns `none` for a run with a visible tool call", () => {
    expect(classifyRunBody(run(thinking("hm"), tool("Bash")))).toEqual({
      fallback: "none",
      markers: [],
    });
  });

  it("treats a lone thinking chip as content enough (`none`)", () => {
    expect(classifyRunBody(run(thinking("reasoning")))).toEqual({
      fallback: "none",
      markers: [],
    });
  });

  it("marks a thinking + ScheduleWakeup wait-loop run as `plumbing`", () => {
    expect(classifyRunBody(run(thinking("wait"), tool("ScheduleWakeup")))).toEqual({
      fallback: "plumbing",
      markers: ["Scheduled a wake-up"],
    });
  });

  it("marks a hidden-tool-only run as `plumbing` even with no thinking", () => {
    expect(classifyRunBody(run(tool("ScheduleWakeup")))).toEqual({
      fallback: "plumbing",
      markers: ["Scheduled a wake-up"],
    });
  });

  it("emits one marker per distinct hidden tool, deduping repeats", () => {
    const { fallback, markers } = classifyRunBody(
      run(tool("ToolSearch"), tool("ScheduleWakeup"), tool("ScheduleWakeup")),
    );
    expect(fallback).toBe("plumbing");
    expect(markers).toEqual(["Searched for tools", "Scheduled a wake-up"]);
  });

  it("suppresses hidden-tool markers when the run also has real text", () => {
    expect(classifyRunBody(run(text("done"), tool("ScheduleWakeup")))).toEqual({
      fallback: "none",
      markers: [],
    });
  });

  it("returns `empty` for a run with no content at all", () => {
    expect(classifyRunBody(run())).toEqual({ fallback: "empty", markers: [] });
    expect(classifyRunBody(run(text(""), thinking("   ")))).toEqual({
      fallback: "empty",
      markers: [],
    });
  });

  it("ignores subagent-child tool calls (rendered by their parent)", () => {
    expect(
      classifyRunBody(run(tool("Bash", { parentToolUseId: "parent-1" }))),
    ).toEqual({ fallback: "empty", markers: [] });
  });
});
