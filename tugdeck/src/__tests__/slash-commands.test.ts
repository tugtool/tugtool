/**
 * slash-commands.test.ts — pure-logic coverage for the local slash-command
 * dispatch infrastructure: the matcher's parsing behavior (bare match, trailing
 * args, unregistered/non-command rejection), case-insensitive completion
 * filtering, name extraction, and predicate-based filtering. These guard
 * behavior, not the registry's contents — adding a command is a registry edit,
 * not a test edit.
 */

import { describe, expect, test } from "bun:test";
import {
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
} from "@/components/tugways/cards/completion-providers/local-commands";

describe("matchLocalSlashCommand", () => {
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

describe("local-command completion", () => {
  function labels(provider: CompletionProvider, query: string): string[] {
    return provider(query).map((item) => item.label);
  }

  test("local provider filters by case-insensitive substring", () => {
    expect(labels(localCommandCompletionProvider(), "perm")).toEqual(["permissions"]);
    expect(labels(localCommandCompletionProvider(), "PERM")).toEqual(["permissions"]);
    expect(labels(localCommandCompletionProvider(), "model")).toEqual(["model"]);
    expect(labels(localCommandCompletionProvider(), "vim")).toEqual([]);
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
