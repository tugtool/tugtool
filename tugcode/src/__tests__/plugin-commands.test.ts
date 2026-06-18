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
  const base: SessionCapabilities = {
    type: "session_capabilities",
    models: [],
    commands: [{ name: "compact" }, { name: "tugplug:commit" }],
    agents: [],
    available_output_styles: [],
    output_style: "",
    account: null,
    effort: null,
    ipc_version: 2,
  };

  test("unions new commands, leaving claude's reported entries untouched", () => {
    const merged = mergePluginCommands(base, [
      { name: "tugplug:commit", description: "would-be-overwrite" },
      { name: "tugplug:devise", description: "Plan." },
    ]);
    // Existing entry kept as-is (no description), new one appended.
    expect(merged.commands).toEqual([
      { name: "compact" },
      { name: "tugplug:commit" },
      { name: "tugplug:devise", description: "Plan." },
    ]);
  });

  test("returns the same caps when there is nothing to add", () => {
    expect(mergePluginCommands(base, [])).toBe(base);
  });
});
