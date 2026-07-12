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
  buildSlashCommandLine,
  isCodeRouteOnlyCommand,
  matchLocalSlashCommand,
  slashCommandName,
  type CommandLineAtom,
} from "@/lib/slash-commands";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
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

  test("local provider matches a non-contiguous subsequence", () => {
    // `pm` is a subsequence of `permissions` (p…m…) but not a substring.
    expect(labels(localCommandCompletionProvider(), "pm")).toContain("permissions");
  });
});

describe("mergeCommandProviders", () => {
  function labels(provider: CompletionProvider, query: string): string[] {
    return provider(query).map((item) => item.label);
  }

  /** A provider over a fixed list of command names (no availability gating). */
  function namesProvider(...names: string[]): CompletionProvider {
    return (() =>
      names.map((name) => ({
        label: name,
        atom: { kind: "atom", type: "command", label: name, value: name },
      }))) as CompletionProvider;
  }

  test("orders by match quality, not the alphabet", () => {
    // The reported bug: `/permi` must surface `permissions` (a prefix hit)
    // above `fewer-permission-prompts` (a word-boundary hit), even though the
    // latter sorts first alphabetically.
    const merged = mergeCommandProviders(
      namesProvider("fewer-permission-prompts"),
      namesProvider("permissions"),
    );
    expect(labels(merged, "permi")).toEqual([
      "permissions",
      "fewer-permission-prompts",
    ]);
  });

  test("empty query falls back to alphabetical order", () => {
    const merged = mergeCommandProviders(
      namesProvider("zebra", "alpha"),
      namesProvider("mango"),
    );
    expect(labels(merged, "")).toEqual(["alpha", "mango", "zebra"]);
  });

  test("dedups by label, first provider wins", () => {
    const merged = mergeCommandProviders(
      namesProvider("permissions"),
      namesProvider("permissions"),
    );
    expect(labels(merged, "permi")).toEqual(["permissions"]);
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

// Build the draft text + positioned atoms for a list of pieces, where a
// string piece is literal text and an atom piece becomes a TUG_ATOM_CHAR
// placeholder at its document position (mirroring the editor's substrate).
function mkDraft(
  pieces: ReadonlyArray<string | { type: string; value: string }>,
): { text: string; atoms: CommandLineAtom[] } {
  let text = "";
  const atoms: CommandLineAtom[] = [];
  for (const piece of pieces) {
    if (typeof piece === "string") {
      text += piece;
    } else {
      atoms.push({ position: text.length, segment: piece });
      text += TUG_ATOM_CHAR;
    }
  }
  return { text, atoms };
}

describe("buildSlashCommandLine", () => {
  test("plain text with no atoms passes through verbatim", () => {
    expect(buildSlashCommandLine("/compact prepare the plan", [])).toBe(
      "/compact prepare the plan",
    );
  });

  test("a lone leading command atom expands to /name", () => {
    const { text, atoms } = mkDraft([{ type: "command", value: "compact" }]);
    expect(buildSlashCommandLine(text, atoms)).toBe("/compact");
  });

  test("command atom + file mention expands to the path, and matches with focus", () => {
    const { text, atoms } = mkDraft([
      { type: "command", value: "compact" },
      " prepare ",
      { type: "file", value: "roadmap/message-architecture.md" },
      " plan",
    ]);
    const line = buildSlashCommandLine(text, atoms);
    expect(line).toBe(
      "/compact prepare roadmap/message-architecture.md plan",
    );
    expect(matchLocalSlashCommand(line)).toEqual({
      name: "compact",
      args: "prepare roadmap/message-architecture.md plan",
    });
  });

  test("typed /compact with a trailing file mention expands the path", () => {
    const { text, atoms } = mkDraft([
      "/compact prepare ",
      { type: "doc", value: "roadmap/x.md" },
    ]);
    expect(buildSlashCommandLine(text, atoms)).toBe(
      "/compact prepare roadmap/x.md",
    );
  });

  test("image atoms are dropped from the reconstructed line", () => {
    const { text, atoms } = mkDraft([
      "/compact ",
      { type: "image", value: "blob:ignored" },
      "focus",
    ]);
    const line = buildSlashCommandLine(text, atoms);
    expect(line).toBe("/compact focus");
    expect(matchLocalSlashCommand(line)).toEqual({
      name: "compact",
      args: "focus",
    });
  });
});

describe("isCodeRouteOnlyCommand — one-shot gating", () => {
  test("the one-shot accelerators are Code-route-only", () => {
    expect(isCodeRouteOnlyCommand("shell")).toBe(true);
    expect(isCodeRouteOnlyCommand("btw")).toBe(true);
  });

  test("ordinary local commands are offered everywhere", () => {
    expect(isCodeRouteOnlyCommand("permissions")).toBe(false);
    expect(isCodeRouteOnlyCommand("model")).toBe(false);
    expect(isCodeRouteOnlyCommand("not-a-command")).toBe(false);
  });

  test("/shell matches with its argument", () => {
    expect(matchLocalSlashCommand("/shell echo hi")).toEqual({
      name: "shell",
      args: "echo hi",
    });
  });
});
