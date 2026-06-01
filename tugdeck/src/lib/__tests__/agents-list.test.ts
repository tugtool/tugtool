import { describe, expect, test } from "bun:test";

import {
  BUILTIN_AGENTS,
  agentTrailingLabel,
  selectLibraryAgents,
  selectRunningAgents,
} from "../agents-list";
import type { SlashCommandInfo } from "../session-metadata-store";
import type { Message } from "../code-session-store/types";

describe("selectLibraryAgents", () => {
  test("always lists the built-in roster, even with no wire agents", () => {
    const names = selectLibraryAgents([]).map((a) => a.name);
    expect(names).toEqual(BUILTIN_AGENTS.map((a) => a.name));
  });

  test("appends plugin / user agents that aren't built-in, sorted", () => {
    const commands: SlashCommandInfo[] = [
      { name: "tugplug:reviewer", category: "agent" },
      { name: "my-helper", category: "agent" },
      { name: "Explore", category: "agent" }, // dup of a built-in → not re-added
      { name: "commit", category: "skill" },
    ];
    const agents = selectLibraryAgents(commands);
    const extras = agents.slice(BUILTIN_AGENTS.length);
    expect(extras.map((a) => a.name)).toEqual(["my-helper", "tugplug:reviewer"]);
    expect(extras[0]).toEqual({ name: "my-helper", origin: "user" });
    expect(extras[1]).toEqual({
      name: "tugplug:reviewer",
      origin: "plugin",
      plugin: "tugplug",
    });
    // Explore appears once (the built-in), not duplicated.
    expect(agents.filter((a) => a.name === "Explore")).toHaveLength(1);
  });
});

describe("agentTrailingLabel", () => {
  test("built-in shows its model; plugin/user show their source", () => {
    expect(
      agentTrailingLabel({ name: "Explore", origin: "built-in", model: "haiku" }),
    ).toBe("haiku");
    expect(
      agentTrailingLabel({ name: "tugplug:x", origin: "plugin", plugin: "tugplug" }),
    ).toBe("Plugin tugplug");
    expect(agentTrailingLabel({ name: "mine", origin: "user" })).toBe("User");
  });
});

describe("selectRunningAgents", () => {
  const toolUse = (
    over: Partial<Extract<Message, { kind: "tool_use" }>>,
  ): Message =>
    ({
      kind: "tool_use",
      toolUseId: "t1",
      toolName: "Task",
      input: {},
      status: "pending",
      result: null,
      structuredResult: null,
      toolWallMs: null,
      ...over,
    }) as Message;

  test("returns pending Task calls with their subagent_type + description", () => {
    const messages: Message[] = [
      toolUse({
        toolUseId: "t1",
        input: { subagent_type: "Explore", description: "scan the repo" },
      }),
    ];
    expect(selectRunningAgents(messages)).toEqual([
      { toolUseId: "t1", subagentType: "Explore", description: "scan the repo" },
    ]);
  });

  test("ignores non-Task tools, done Task calls, and non-tool messages", () => {
    const messages: Message[] = [
      toolUse({ toolUseId: "a", toolName: "Bash", status: "pending" }),
      toolUse({ toolUseId: "b", toolName: "Task", status: "done" }),
      { kind: "assistant_text", text: "hi" } as Message,
    ];
    expect(selectRunningAgents(messages)).toEqual([]);
  });

  test("falls back to 'subagent' when subagent_type is missing", () => {
    expect(selectRunningAgents([toolUse({ input: {} })])[0].subagentType).toBe(
      "subagent",
    );
  });
});
