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
  slashCommandName,
} from "@/lib/slash-commands";
import type {
  CompletionItem,
  CompletionProvider,
} from "@/lib/tug-text-types";
import {
  filterCommandProvider,
  localCommandCompletionProvider,
  mergeCommandProviders,
} from "@/components/tugways/cards/completion-providers/local-commands";

describe("matchLocalSlashCommand", () => {
  test("permissions, model, rewind, resume, diff, and context are registered", () => {
    expect(LOCAL_SLASH_COMMANDS.map((c) => c.name)).toEqual([
      "permissions",
      "model",
      "rewind",
      "resume",
      "diff",
      "context",
      "skills",
      "agents",
      "memory",
      "hooks",
      "copy",
      "help",
      "clear",
      "export",
      "add-dir",
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
      "context",
      "skills",
      "agents",
      "memory",
      "hooks",
      "copy",
      "help",
      "clear",
      "export",
      "add-dir",
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
      "context",
      "skills",
      "agents",
      "memory",
      "hooks",
      "copy",
      "help",
      "clear",
      "export",
      "add-dir",
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

  test("merge dedups a name claude also reports (local wins) and lists alphabetically", () => {
    const claude: CompletionProvider = () => [
      mkItem("permissions"),
      mkItem("commit"),
    ];
    const merged = mergeCommandProviders(localCommandCompletionProvider(), claude);
    // `permissions` appears once (local wins the dedup); the popup ORDER is
    // alphabetical regardless of registry / claude-catalog order.
    expect(labels(merged, "")).toEqual([
      "add-dir",
      "agents",
      "clear",
      "commit",
      "context",
      "copy",
      "diff",
      "export",
      "help",
      "hooks",
      "memory",
      "model",
      "permissions",
      "resume",
      "rewind",
      "skills",
    ]);
  });
});

describe("slashCommandName", () => {
  test("extracts the name from a command line, args and whitespace tolerated", () => {
    expect(slashCommandName("/vim")).toBe("vim");
    expect(slashCommandName("  /add-dir /tmp/foo  ")).toBe("add-dir");
    expect(slashCommandName("/btw some text")).toBe("btw");
  });

  test("returns null for non-command text", () => {
    for (const input of ["hello", "", "/", "look /vim here"]) {
      expect(slashCommandName(input)).toBeNull();
    }
  });
});

describe("filterCommandProvider", () => {
  test("drops items whose name fails the predicate", () => {
    const base: CompletionProvider = () => [
      mkItem("init"),
      mkItem("vim"),
      mkItem("compact"),
      mkItem("theme"),
    ];
    const filtered = filterCommandProvider(
      base,
      (name) => name !== "vim" && name !== "theme",
    );
    expect(filtered("").map((i) => i.label)).toEqual(["init", "compact"]);
  });

  test("passes the query through to the wrapped provider", () => {
    const base: CompletionProvider = (q) => (q === "in" ? [mkItem("init")] : []);
    const filtered = filterCommandProvider(base, () => true);
    expect(filtered("in").map((i) => i.label)).toEqual(["init"]);
    expect(filtered("xx")).toEqual([]);
  });
});

function mkItem(name: string): CompletionItem {
  return {
    label: name,
    atom: { kind: "atom", type: "command", label: name, value: name },
  };
}
