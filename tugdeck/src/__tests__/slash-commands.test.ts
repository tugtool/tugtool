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
  matchLocalSlashCommand,
  slashCommandName,
  type CommandLineAtom,
} from "@/lib/slash-commands";
import { isBangCommand, matchBangCommandLine } from "@/lib/bang-commands";
import { planCommitVerb } from "@/lib/commit-verb-plan";
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

  test("/commit matches locally in every form — never falls through to claude", () => {
    // The pinned shadowing contract ([P04]): a matched local command is
    // dispatched via RUN_SLASH_COMMAND and never reaches codeSessionStore.send,
    // so claude's built-in /commit is dead. All three Table T01 invocations
    // must match.
    expect(matchLocalSlashCommand("/commit")).toEqual({ name: "commit", args: "" });
    expect(matchLocalSlashCommand("/commit now")).toEqual({
      name: "commit",
      args: "now",
    });
    expect(matchLocalSlashCommand("/commit Fix the flux capacitor")).toEqual({
      name: "commit",
      args: "Fix the flux capacitor",
    });
  });
});

describe("planCommitVerb (Table T01)", () => {
  test("bare /commit: beat 1 with no ready draft, beat 2 with one", () => {
    expect(planCommitVerb("", null)).toEqual({ kind: "draft" });
    expect(planCommitVerb("", "Draft message")).toEqual({
      kind: "land",
      message: "Draft message",
    });
  });

  test("/commit <message>: the explicit message wins over the draft", () => {
    expect(planCommitVerb("Fix the thing", null)).toEqual({
      kind: "land",
      message: "Fix the thing",
    });
    expect(planCommitVerb("Fix the thing", "Draft message")).toEqual({
      kind: "land",
      message: "Fix the thing",
    });
  });

  test("/commit now: generate-then-land without a draft, plain land with one", () => {
    expect(planCommitVerb("now", null)).toEqual({ kind: "generate-then-land" });
    expect(planCommitVerb("now", "Draft message")).toEqual({
      kind: "land",
      message: "Draft message",
    });
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

  test("claude's advertised commit loses to the local /commit entry", () => {
    // Exactly one /commit in the popup ([P04]): the session card lists the
    // local provider FIRST, so first-wins dedup resolves the name to the
    // local entry (described as Tug's landing verb) and claude's built-in
    // duplicate never shows. A non-colliding claude entry survives.
    const merged = mergeCommandProviders(
      localCommandCompletionProvider(),
      namesProvider("commit", "tugplug:devise"),
    );
    const items = merged("commit");
    const commitItems = items.filter((i) => i.label === "commit");
    expect(commitItems).toHaveLength(1);
    expect(commitItems[0].description).toContain("Land this session's changes");
    // The non-colliding claude entry survives the merge.
    expect(items.some((i) => i.label === "tugplug:devise")).toBe(true);
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

describe("bang routings (matchBangCommandLine)", () => {
  test("the five routings are bang commands, not slash commands", () => {
    for (const name of ["shell", "btw", "find", "changes", "history"]) {
      expect(isBangCommand(name)).toBe(true);
      expect(matchLocalSlashCommand(`/${name}`)).toBeNull();
    }
    expect(isBangCommand("model")).toBe(false);
  });

  test("!shell matches with its argument", () => {
    expect(matchBangCommandLine("!shell echo hi")).toEqual({
      name: "shell",
      args: "echo hi",
    });
  });

  test("bare !changes and !history match with empty args", () => {
    expect(matchBangCommandLine("!changes")).toEqual({
      name: "changes",
      args: "",
    });
    expect(matchBangCommandLine("!history")).toEqual({
      name: "history",
      args: "",
    });
  });

  test("!changes carries its directive + message as args (verb split is the surface's job)", () => {
    expect(matchBangCommandLine("!changes describe")).toEqual({
      name: "changes",
      args: "describe",
    });
    expect(matchBangCommandLine("!changes commit fix: thing")).toEqual({
      name: "changes",
      args: "commit fix: thing",
    });
  });

  test("!history carries the whole question as args", () => {
    expect(matchBangCommandLine("!history what changed")).toEqual({
      name: "history",
      args: "what changed",
    });
  });

  test("!<anything else> is the shell escape hatch", () => {
    expect(matchBangCommandLine("!git status")).toEqual({
      name: "shell",
      args: "git status",
    });
    expect(matchBangCommandLine("!./run.sh -v")).toEqual({
      name: "shell",
      args: "./run.sh -v",
    });
    // A bare `!` routes to shell with empty args (the surface shows usage).
    expect(matchBangCommandLine("!")).toEqual({ name: "shell", args: "" });
  });

  test("prose is never a bang routing", () => {
    // `!` followed by whitespace, or a line not leading with `!`.
    expect(matchBangCommandLine("! wow that worked")).toBeNull();
    expect(matchBangCommandLine("hello !shell")).toBeNull();
    expect(matchBangCommandLine("plain prose")).toBeNull();
    expect(matchBangCommandLine("/model")).toBeNull();
  });

  test("a command atom + 'commit <msg>' reconstructs !changes commit <msg>", () => {
    const { text, atoms } = mkDraft([
      { type: "command", value: "changes" },
      " commit fix: the parser",
    ]);
    const line = buildSlashCommandLine(text, atoms);
    expect(line).toBe("!changes commit fix: the parser");
    expect(matchBangCommandLine(line)).toEqual({
      name: "changes",
      args: "commit fix: the parser",
    });
  });

  test("a non-bang command atom still reconstructs with the slash sigil", () => {
    const { text, atoms } = mkDraft([
      { type: "command", value: "compact" },
      " focus",
    ]);
    expect(buildSlashCommandLine(text, atoms)).toBe("/compact focus");
  });
});
