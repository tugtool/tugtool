/**
 * slash-commands.test.ts — pure-logic coverage for the local
 * slash-command matcher and the dev-card completion merge ([#step-1c]).
 *
 * No store, no DOM — these are the unit-testable halves of Step 1c. The
 * submit-time dispatch, the sheet open, and the no-send-to-claude
 * behavior are covered by the real-app test
 * (`at0089-slash-permissions.test.ts`).
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
  test("matches a bare no-arg command, args empty", () => {
    expect(matchLocalSlashCommand("/permissions")).toEqual({
      name: "permissions",
      args: "",
    });
  });

  test("tolerates surrounding whitespace", () => {
    expect(matchLocalSlashCommand("  /permissions  ")).toEqual({
      name: "permissions",
      args: "",
    });
  });

  test("a no-arg command with trailing args does NOT match", () => {
    // `/permissions` takes no args; `/permissions foo` is not the command
    // — it falls through to claude verbatim.
    expect(matchLocalSlashCommand("/permissions foo")).toBeNull();
  });

  test("an unknown command returns null (sent to claude)", () => {
    expect(matchLocalSlashCommand("/commit")).toBeNull();
    expect(matchLocalSlashCommand("/vim")).toBeNull();
  });

  test("non-command text returns null", () => {
    expect(matchLocalSlashCommand("permissions")).toBeNull();
    expect(matchLocalSlashCommand("hello /permissions")).toBeNull();
    expect(matchLocalSlashCommand("")).toBeNull();
    expect(matchLocalSlashCommand("/")).toBeNull();
  });

  test("the seed registry is all no-arg (arg capture lands with /btw, Step 13)", () => {
    // The matcher's arg-capture branch (`takesArgs` → capture the
    // remainder) activates only for arg-accepting commands; the seed
    // registry has none, so the only exercisable arg behavior today is
    // the no-arg rejection above (`/permissions foo` → null). When
    // `/btw <text>` lands with `takesArgs: true`, its capture is asserted
    // in that step. Pin the seed's shape so this stays honest.
    const spec = LOCAL_SLASH_COMMANDS.find((c) => c.name === "permissions");
    expect(spec).toBeDefined();
    expect(matchLocalSlashCommand("/permissions extra")).toBeNull();
  });
});

describe("local-command completion + merge", () => {
  function labels(provider: CompletionProvider, query: string): string[] {
    return provider(query).map((item) => item.label);
  }

  test("local provider lists registry commands, filters by substring", () => {
    const provider = localCommandCompletionProvider();
    expect(labels(provider, "")).toEqual(
      LOCAL_SLASH_COMMANDS.map((c) => c.name),
    );
    expect(labels(provider, "perm")).toContain("permissions");
    expect(labels(provider, "zzz")).toEqual([]);
  });

  test("local items are command atoms — same shape as claude's commands", () => {
    // Uniform with claude's slash completions: accepting one inserts a
    // command atom. The local/remote split happens at submit, not here.
    const [item] = localCommandCompletionProvider()("permissions");
    expect(item.atom.type).toBe("command");
    expect(item.atom.value).toBe("permissions");
  });

  test("merge concatenates providers, local first", () => {
    const claude: CompletionProvider = () => [
      mkItem("commit"),
      mkItem("deep-research"),
    ];
    const merged = mergeCommandProviders(
      localCommandCompletionProvider(),
      claude,
    );
    expect(labels(merged, "")).toEqual([
      "permissions", // local, first
      "commit",
      "deep-research",
    ]);
  });

  test("merge dedups by label, first (local) wins", () => {
    // Claude also reports `/permissions` — the merged list shows it once,
    // and the surviving entry is the local one (listed first).
    const claudeWithDup: CompletionProvider = () => [
      mkItem("permissions"),
      mkItem("commit"),
    ];
    const merged = mergeCommandProviders(
      localCommandCompletionProvider(),
      claudeWithDup,
    );
    expect(labels(merged, "")).toEqual(["permissions", "commit"]);
  });
});

function mkItem(name: string): CompletionItem {
  return {
    label: name,
    atom: { kind: "atom", type: "command", label: name, value: name },
  };
}
