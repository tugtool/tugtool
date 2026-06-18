/**
 * plugin-commands — unit tests for the turn-free plugin-command catalog
 * augmentation: enumerating a plugin's commands from disk and merging them
 * into the `session_capabilities` catalog. See `capabilities.ts`.
 */

import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  enumeratePluginCommands,
  mergePluginCommands,
} from "../capabilities.ts";
import type { SessionCapabilities } from "../types.ts";

const created: string[] = [];

function makePlugin(
  name: string,
  skills: Array<{ dir: string; frontmatter?: string }>,
  commands: string[] = [],
): string {
  const root = mkdtempSync(join(tmpdir(), "plugincmd-"));
  created.push(root);
  const dir = join(root, name);
  mkdirSync(join(dir, "skills"), { recursive: true });
  for (const s of skills) {
    mkdirSync(join(dir, "skills", s.dir), { recursive: true });
    const body = s.frontmatter ? `---\n${s.frontmatter}\n---\nbody` : "body";
    writeFileSync(join(dir, "skills", s.dir, "SKILL.md"), body);
  }
  if (commands.length > 0) {
    mkdirSync(join(dir, "commands"), { recursive: true });
    for (const c of commands) writeFileSync(join(dir, "commands", `${c}.md`), "cmd");
  }
  return dir;
}

afterAll(() => {
  for (const r of created) rmSync(r, { recursive: true, force: true });
});

describe("enumeratePluginCommands", () => {
  test("namespaces skills as <plugin>:<name> with description + arg hint", () => {
    const dir = makePlugin("tugplug", [
      {
        dir: "commit",
        frontmatter: "name: commit\ndescription: Make a commit.",
      },
      {
        dir: "devise",
        frontmatter: "name: devise\ndescription: Plan.\nargument-hint: <idea>",
      },
    ]);
    const cmds = enumeratePluginCommands(dir);
    expect(cmds).toContainEqual({
      name: "tugplug:commit",
      description: "Make a commit.",
    });
    expect(cmds).toContainEqual({
      name: "tugplug:devise",
      description: "Plan.",
      argumentHint: "<idea>",
    });
  });

  test("falls back to the directory name when frontmatter lacks `name`", () => {
    const dir = makePlugin("tugplug", [{ dir: "audit" }]);
    expect(enumeratePluginCommands(dir)).toEqual([{ name: "tugplug:audit" }]);
  });

  test("includes commands/*.md files", () => {
    const dir = makePlugin("tugplug", [], ["release"]);
    expect(enumeratePluginCommands(dir)).toContainEqual({
      name: "tugplug:release",
    });
  });

  test("returns [] for a missing plugin dir (never throws)", () => {
    expect(enumeratePluginCommands("/no/such/plugin")).toEqual([]);
  });
});

describe("mergePluginCommands", () => {
  function caps(commands: SessionCapabilities["commands"]): SessionCapabilities {
    return {
      type: "session_capabilities",
      models: [],
      commands,
      agents: [],
      available_output_styles: [],
      output_style: "",
      account: null,
      effort: null,
      ipc_version: 2,
    };
  }

  test("replaces claude's bare leaf with the qualified form (no duplicate)", () => {
    // claude's handshake reports the plugin skill bare; enumeration supplies
    // the qualified twin. Result: qualified only.
    const merged = mergePluginCommands(
      caps([{ name: "compact" }, { name: "commit" }, { name: "code-review" }]),
      [{ name: "tugplug:commit", description: "Make a commit." }],
    );
    const names = merged.commands.map((c) => c.name);
    expect(names).not.toContain("commit");
    expect(names).toContain("tugplug:commit");
    // Genuine bare user skills / built-ins are untouched.
    expect(names).toContain("compact");
    expect(names).toContain("code-review");
  });

  test("does not double-add when the qualified form is already present", () => {
    const merged = mergePluginCommands(
      caps([{ name: "tugplug:commit" }]),
      [{ name: "tugplug:commit", description: "Make a commit." }],
    );
    expect(merged.commands.map((c) => c.name)).toEqual(["tugplug:commit"]);
  });

  test("returns the same caps when there is nothing to add", () => {
    const c = caps([{ name: "compact" }]);
    expect(mergePluginCommands(c, [])).toBe(c);
  });
});
