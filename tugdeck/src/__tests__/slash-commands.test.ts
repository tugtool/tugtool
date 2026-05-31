/**
 * slash-commands.test.ts — pure-logic coverage for the local
 * slash-command dispatch infrastructure ([#step-1c]) with `/permissions`
 * ([#step-1.6]) and `/model` ([#step-2b]) registered as the live consumers.
 *
 * `/permissions` opens the tool-permission rules editor; `/model` opens the
 * model picker. The permission *mode* chip is a click + `Shift+Tab` control,
 * not a slash command, so it is not in the registry. These tests guard the
 * matcher shape, the completion provider, and the merge.
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
  test("permissions, model, rewind, resume, and diff are registered", () => {
    expect(LOCAL_SLASH_COMMANDS.map((c) => c.name)).toEqual([
      "permissions",
      "model",
      "rewind",
      "resume",
      "diff",
    ]);
  });

  test("bare /permissions and /model match, with surrounding whitespace tolerated", () => {
    expect(matchLocalSlashCommand("/permissions")).toEqual({
      name: "permissions",
      args: "",
    });
    expect(matchLocalSlashCommand("  /permissions  ")).toEqual({
      name: "permissions",
      args: "",
    });
    expect(matchLocalSlashCommand("/model")).toEqual({
      name: "model",
      args: "",
    });
  });

  test("a no-arg command with trailing args does not match (sent to claude)", () => {
    expect(matchLocalSlashCommand("/permissions foo")).toBeNull();
  });

  test("unregistered names and non-command text return null", () => {
    for (const input of ["/vim", "/theme", "permissions", "hello /permissions", "", "/"]) {
      expect(matchLocalSlashCommand(input)).toBeNull();
    }
  });
});

describe("local-command completion + merge", () => {
  function labels(provider: CompletionProvider, query: string): string[] {
    return provider(query).map((item) => item.label);
  }

  test("local provider offers permissions, model, and rewind as command atoms", () => {
    const items = localCommandCompletionProvider()("");
    expect(items.map((i) => i.label)).toEqual([
      "permissions",
      "model",
      "rewind",
      "resume",
      "diff",
    ]);
    expect(items[0].atom).toEqual({
      kind: "atom",
      type: "command",
      label: "permissions",
      value: "permissions",
    });
  });

  test("isOffered gates a command out of the list (empty-state, e.g. /rewind)", () => {
    const gated = localCommandCompletionProvider({
      isOffered: (name) => name !== "rewind",
    });
    expect(gated("").map((i) => i.label)).toEqual([
      "permissions",
      "model",
      "resume",
      "diff",
    ]);
    // The gate is consulted on substring queries too.
    expect(gated("rew").map((i) => i.label)).toEqual([]);
  });

  test("local provider filters by case-insensitive substring", () => {
    expect(labels(localCommandCompletionProvider(), "perm")).toEqual(["permissions"]);
    expect(labels(localCommandCompletionProvider(), "PERM")).toEqual(["permissions"]);
    expect(labels(localCommandCompletionProvider(), "model")).toEqual(["model"]);
    expect(labels(localCommandCompletionProvider(), "vim")).toEqual([]);
  });

  test("merge lists local first and dedups a name claude also reports", () => {
    const claude: CompletionProvider = () => [
      mkItem("permissions"),
      mkItem("commit"),
    ];
    const merged = mergeCommandProviders(localCommandCompletionProvider(), claude);
    // permissions appears once (local wins), then the other local commands,
    // then claude's remaining commands.
    expect(labels(merged, "")).toEqual([
      "permissions",
      "model",
      "rewind",
      "resume",
      "diff",
      "commit",
    ]);
  });
});

function mkItem(name: string): CompletionItem {
  return {
    label: name,
    atom: { kind: "atom", type: "command", label: name, value: name },
  };
}
