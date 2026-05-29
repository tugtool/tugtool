/**
 * slash-commands.test.ts — pure-logic coverage for the local
 * slash-command dispatch infrastructure ([#step-1c]) with `/permissions`
 * registered ([#step-1.6]) as the first live consumer.
 *
 * `/permissions` opens the tool-permission rules editor; the permission *mode*
 * chip is a click + `Shift+Tab` control, not a slash command, so it is not in
 * the registry. These tests guard the matcher shape, the completion provider,
 * and the merge.
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

describe("matchLocalSlashCommand", () => {
  test("permissions is registered", () => {
    expect(LOCAL_SLASH_COMMANDS.map((c) => c.name)).toEqual(["permissions"]);
  });

  test("bare /permissions matches, with surrounding whitespace tolerated", () => {
    expect(matchLocalSlashCommand("/permissions")).toEqual({
      name: "permissions",
      args: "",
    });
    expect(matchLocalSlashCommand("  /permissions  ")).toEqual({
      name: "permissions",
      args: "",
    });
  });

  test("a no-arg command with trailing args does not match (sent to claude)", () => {
    expect(matchLocalSlashCommand("/permissions foo")).toBeNull();
  });

  test("unregistered names and non-command text return null", () => {
    for (const input of ["/vim", "/model", "permissions", "hello /permissions", "", "/"]) {
      expect(matchLocalSlashCommand(input)).toBeNull();
    }
  });
});

describe("local-command completion + merge", () => {
  function labels(provider: CompletionProvider, query: string): string[] {
    return provider(query).map((item) => item.label);
  }

  test("local provider offers permissions as a command atom", () => {
    const items = localCommandCompletionProvider()("");
    expect(items.map((i) => i.label)).toEqual(["permissions"]);
    expect(items[0].atom).toEqual({
      kind: "atom",
      type: "command",
      label: "permissions",
      value: "permissions",
    });
  });

  test("local provider filters by case-insensitive substring", () => {
    expect(labels(localCommandCompletionProvider(), "perm")).toEqual(["permissions"]);
    expect(labels(localCommandCompletionProvider(), "PERM")).toEqual(["permissions"]);
    expect(labels(localCommandCompletionProvider(), "model")).toEqual([]);
  });

  test("merge lists local first and dedups a name claude also reports", () => {
    const claude: CompletionProvider = () => [
      mkItem("permissions"),
      mkItem("commit"),
    ];
    const merged = mergeCommandProviders(localCommandCompletionProvider(), claude);
    // permissions appears once (local wins), claude's other commands follow.
    expect(labels(merged, "")).toEqual(["permissions", "commit"]);
  });
});

function mkItem(name: string): CompletionItem {
  return {
    label: name,
    atom: { kind: "atom", type: "command", label: name, value: name },
  };
}
