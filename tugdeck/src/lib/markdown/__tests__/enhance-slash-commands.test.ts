/**
 * Pure-logic coverage for `enhance-slash-commands`.
 *
 * The DOM pass (`enhanceSlashCommands`) tags `<code>` spans and requires a
 * real DOM at runtime — it's validated in the real app (the transcript
 * click-to-run gesture), not via fake-DOM render tests (project policy:
 * no jsdom / happy-dom).
 *
 * This file pins the *pure* grammar — `parseSlashCommandLine` — the strict
 * matcher that decides which code spans are even candidates and splits a
 * command name from its argument text. The known-command predicate is the
 * authoritative clickability gate, layered on top of this in the app.
 */

import { describe, expect, test } from "bun:test";

import { parseSlashCommandLine } from "../enhance-slash-commands";

describe("parseSlashCommandLine — accepts well-formed command lines", () => {
  test("bare command", () => {
    expect(parseSlashCommandLine("/diff")).toEqual({ name: "diff", args: "" });
  });

  test("plugin:command", () => {
    expect(parseSlashCommandLine("/tugplug:implement")).toEqual({
      name: "tugplug:implement",
      args: "",
    });
  });

  test("command with a single-word argument", () => {
    expect(parseSlashCommandLine("/model opus")).toEqual({
      name: "model",
      args: "opus",
    });
  });

  test("plugin:command with a path argument", () => {
    expect(
      parseSlashCommandLine("/tugplug:implement roadmap/find-route.md"),
    ).toEqual({ name: "tugplug:implement", args: "roadmap/find-route.md" });
  });

  test("multi-word argument is captured whole, trimmed", () => {
    expect(parseSlashCommandLine("/tugplug:implement  a plan ; Steps 3-5")).toEqual(
      { name: "tugplug:implement", args: "a plan ; Steps 3-5" },
    );
  });

  test("single-character command name", () => {
    expect(parseSlashCommandLine("/x")).toEqual({ name: "x", args: "" });
  });

  test("name with interior hyphen / underscore / digit", () => {
    expect(parseSlashCommandLine("/fewer-permission-prompts")).toEqual({
      name: "fewer-permission-prompts",
      args: "",
    });
    expect(parseSlashCommandLine("/claude_api")).toEqual({
      name: "claude_api",
      args: "",
    });
  });

  test("surrounding whitespace on the whole span is tolerated", () => {
    expect(parseSlashCommandLine("  /diff HEAD  ")).toEqual({
      name: "diff",
      args: "HEAD",
    });
  });
});

describe("parseSlashCommandLine — rejects non-commands", () => {
  const rejected = [
    ["empty string", ""],
    ["whitespace only", "   "],
    ["no leading slash", "diff"],
    ["bare slash", "/"],
    ["absolute path (uppercase-led)", "/Users/kocienda/x"],
    ["absolute path (lowercase, interior slash)", "/usr/bin/env"],
    ["url with scheme", "https://status.claude.com"],
    ["leading hyphen in name", "/-diff"],
    ["trailing hyphen in name", "/diff-"],
    ["double colon / two namespaces", "/a:b:c"],
    ["prose that merely contains a slash", "run the /diff command"],
  ] as const;

  for (const [label, input] of rejected) {
    test(label, () => {
      expect(parseSlashCommandLine(input)).toBeNull();
    });
  }
});
