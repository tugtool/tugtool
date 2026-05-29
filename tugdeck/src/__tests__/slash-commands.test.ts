/**
 * slash-commands.test.ts — pure-logic coverage for the local
 * slash-command dispatch infrastructure ([#step-1c]).
 *
 * The registry is currently **empty** — the permission *mode* chip is not a
 * slash command, and `/permissions` (the rules editor) is [#step-1.6]. So the
 * matcher returns null for everything and the popup shows no local commands.
 * These tests guard the mechanics (matcher shape, provider, merge) so they
 * stay correct as the registry repopulates; command-specific matches return
 * with the first registered command.
 */

import { describe, expect, test } from "bun:test";
import {
  LOCAL_SLASH_COMMANDS,
  matchLocalSlashCommand,
} from "@/lib/slash-commands";
import type {
  CompletionItem,
  CompletionProvider,
} from "@/lib/tug-text-types";
import {
  localCommandCompletionProvider,
  mergeCommandProviders,
} from "@/components/tugways/cards/completion-providers/local-commands";

describe("matchLocalSlashCommand (empty registry)", () => {
  test("the registry is empty", () => {
    expect(LOCAL_SLASH_COMMANDS).toEqual([]);
  });

  test("no input matches — nothing is a local command yet", () => {
    for (const input of [
      "/permissions",
      "  /permissions  ",
      "/permissions foo",
      "/commit",
      "/vim",
      "permissions",
      "hello /permissions",
      "",
      "/",
    ]) {
      expect(matchLocalSlashCommand(input)).toBeNull();
    }
  });
});

describe("local-command completion + merge", () => {
  function labels(provider: CompletionProvider, query: string): string[] {
    return provider(query).map((item) => item.label);
  }

  test("local provider is empty (no local commands registered yet)", () => {
    expect(labels(localCommandCompletionProvider(), "")).toEqual([]);
  });

  test("merge passes claude commands through when local is empty", () => {
    const claude: CompletionProvider = () => [
      mkItem("commit"),
      mkItem("deep-research"),
    ];
    const merged = mergeCommandProviders(
      localCommandCompletionProvider(),
      claude,
    );
    expect(labels(merged, "")).toEqual(["commit", "deep-research"]);
  });

  test("merge dedups by label (local listed first wins, when present)", () => {
    // Mechanics guard for when the registry repopulates: a name appearing in
    // both the first and second provider survives once, first-wins.
    const first: CompletionProvider = () => [mkItem("permissions"), mkItem("a")];
    const second: CompletionProvider = () => [mkItem("permissions"), mkItem("b")];
    expect(labels(mergeCommandProviders(first, second), "")).toEqual([
      "permissions",
      "a",
      "b",
    ]);
  });
});

function mkItem(name: string): CompletionItem {
  return {
    label: name,
    atom: { kind: "atom", type: "command", label: name, value: name },
  };
}
