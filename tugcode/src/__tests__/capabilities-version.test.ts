/**
 * capabilities-version — unit tests for the Claude Code version that tugcode
 * folds into the turn-free `session_capabilities` handshake. claude's
 * `initialize` response carries no version (only the post-turn `system/init`
 * does), so tugcode runs `claude --version` and parses the leading semver,
 * making the frontend's Claude Code badge correct from the drop. See
 * `capabilities.ts`.
 */

import { describe, expect, test } from "bun:test";

import {
  parseClaudeVersion,
  buildSessionCapabilities,
} from "../capabilities.ts";

describe("parseClaudeVersion", () => {
  test("extracts the semver from real `claude --version` output", () => {
    expect(parseClaudeVersion("2.1.195 (Claude Code)\n")).toBe("2.1.195");
  });

  test("tolerates missing trailing label / whitespace", () => {
    expect(parseClaudeVersion("2.1.195")).toBe("2.1.195");
    expect(parseClaudeVersion("  2.1.195 (Claude Code)  ")).toBe("2.1.195");
  });

  test("returns null for output with no leading dotted-numeric version", () => {
    expect(parseClaudeVersion("")).toBeNull();
    expect(parseClaudeVersion("claude: command not found")).toBeNull();
    expect(parseClaudeVersion("v2.1.195")).toBeNull();
  });
});

describe("buildSessionCapabilities — version fold-in", () => {
  test("carries the supplied version onto the capabilities object", () => {
    const caps = buildSessionCapabilities({ models: [] }, null, "2.1.195");
    expect(caps).not.toBeNull();
    expect(caps!.version).toBe("2.1.195");
  });

  test("defaults version to null when none is supplied", () => {
    const caps = buildSessionCapabilities({ models: [] });
    expect(caps).not.toBeNull();
    expect(caps!.version).toBeNull();
  });
});
