import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_CLAUDE_CODE_SETTINGS,
  readClaudeCodeSettings,
} from "../claude-code-settings.ts";

// Per-test scratch dirs so a malformed file from one test cannot bleed
// into another. Cleaned up in afterEach.
let scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "tugcode-settings-"));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  scratchDirs = [];
});

describe("readClaudeCodeSettings", () => {
  test("reads autoCompactEnabled = false from a present file", async () => {
    const dir = scratch();
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify({ autoCompactEnabled: false }));
    const settings = await readClaudeCodeSettings(path);
    expect(settings.autoCompactEnabled).toBe(false);
  });

  test("reads autoCompactEnabled = true from a present file", async () => {
    const dir = scratch();
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify({ autoCompactEnabled: true }));
    const settings = await readClaudeCodeSettings(path);
    expect(settings.autoCompactEnabled).toBe(true);
  });

  test("preserves other unrecognized fields without surfacing them", async () => {
    // Forward-compat: a settings.json carrying fields we don't read
    // today must not break parsing. We return only the fields we
    // declare in ClaudeCodeSettings.
    const dir = scratch();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        autoCompactEnabled: false,
        theme: "dark",
        env: { FOO: "bar" },
        nestedThing: { a: 1, b: [true, "x"] },
      }),
    );
    const settings = await readClaudeCodeSettings(path);
    expect(settings.autoCompactEnabled).toBe(false);
    expect(Object.keys(settings)).toEqual(["autoCompactEnabled"]);
  });

  test("returns defaults for a missing file", async () => {
    const dir = scratch();
    const path = join(dir, "absent.json");
    const settings = await readClaudeCodeSettings(path);
    expect(settings).toEqual(DEFAULT_CLAUDE_CODE_SETTINGS);
  });

  test("returns defaults for malformed JSON", async () => {
    const dir = scratch();
    const path = join(dir, "settings.json");
    writeFileSync(path, "not-json-at-all{{");
    const settings = await readClaudeCodeSettings(path);
    expect(settings).toEqual(DEFAULT_CLAUDE_CODE_SETTINGS);
  });

  test("returns defaults when the top-level JSON is not an object", async () => {
    const dir = scratch();
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify(["array", "not", "object"]));
    const settings = await readClaudeCodeSettings(path);
    expect(settings).toEqual(DEFAULT_CLAUDE_CODE_SETTINGS);
  });

  test("returns Claude Code's true default (autoCompactEnabled: true) when the field is absent", async () => {
    const dir = scratch();
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify({ theme: "dark" }));
    const settings = await readClaudeCodeSettings(path);
    expect(settings.autoCompactEnabled).toBe(true);
  });

  test("ignores autoCompactEnabled with a non-boolean type", async () => {
    // A misconfigured settings.json with `"autoCompactEnabled": "true"`
    // (string instead of bool) defaults to the documented behavior.
    const dir = scratch();
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify({ autoCompactEnabled: "true" }));
    const settings = await readClaudeCodeSettings(path);
    expect(settings.autoCompactEnabled).toBe(true);
  });
});
