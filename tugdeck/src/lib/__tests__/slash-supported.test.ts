/**
 * slash-supported.test.ts — pure-logic coverage for the [D14] three-tier
 * slash-command allowlist ([#step-13a]).
 */

import { describe, expect, test } from "bun:test";
import {
  HIDDEN_SLASH_COMMANDS,
  classifySlashCommand,
  isHiddenSlashCommand,
  isUnknownRemoteCommand,
} from "@/lib/slash-supported";
import { LOCAL_SLASH_COMMANDS } from "@/lib/slash-commands";

describe("classifySlashCommand", () => {
  test("a registered local command is supported-local", () => {
    for (const cmd of LOCAL_SLASH_COMMANDS) {
      expect(classifySlashCommand(cmd.name)).toBe("supported-local");
    }
  });

  test("a known-unsupported command is hidden", () => {
    for (const name of ["vim", "theme", "color", "mcp", "bug", "quit", "status"]) {
      expect(classifySlashCommand(name)).toBe("hidden");
    }
  });

  test("a genuine pass-through is pass-through", () => {
    // prompt-type + backend-effecting locals that run a real turn verbatim.
    for (const name of ["init", "insights", "recap"]) {
      expect(classifySlashCommand(name)).toBe("pass-through");
    }
  });

  test("an unknown name defaults to pass-through (never swallowed)", () => {
    for (const name of ["wibble", "tugplug:commit", "some-future-command"]) {
      expect(classifySlashCommand(name)).toBe("pass-through");
    }
  });
});

describe("isHiddenSlashCommand", () => {
  test("agrees with classifySlashCommand", () => {
    for (const name of ["vim", "permissions", "init", "wibble", "bug"]) {
      expect(isHiddenSlashCommand(name)).toBe(
        classifySlashCommand(name) === "hidden",
      );
    }
  });
});

describe("set integrity", () => {
  test("no command is both supported-local and hidden", () => {
    for (const cmd of LOCAL_SLASH_COMMANDS) {
      expect(HIDDEN_SLASH_COMMANDS.has(cmd.name)).toBe(false);
    }
  });

  test("/copy is not hidden — it becomes a local command in a later sub-step", () => {
    // The audit's SKIP set lists /copy as a *command*, but the dev card adds
    // it to the [D23] registry; guard against re-hiding it here.
    expect(HIDDEN_SLASH_COMMANDS.has("copy")).toBe(false);
  });
});

describe("isUnknownRemoteCommand", () => {
  const catalog = ["init", "insights", "compact", "tugplug:commit"];

  test("an empty catalog never reports unknown (handshake not landed yet)", () => {
    expect(isUnknownRemoteCommand("foo", [])).toBe(false);
    expect(isUnknownRemoteCommand("init", [])).toBe(false);
  });

  test("a pass-through name absent from a populated catalog is unknown", () => {
    expect(isUnknownRemoteCommand("foo", catalog)).toBe(true);
    expect(isUnknownRemoteCommand("looop", catalog)).toBe(true);
  });

  test("a pass-through name present in the catalog is NOT unknown (sent to claude)", () => {
    expect(isUnknownRemoteCommand("init", catalog)).toBe(false);
    expect(isUnknownRemoteCommand("tugplug:commit", catalog)).toBe(false);
  });

  test("local and hidden names are never 'unknown' (handled / swallowed first)", () => {
    // A local command is dispatched to its surface; a hidden one is
    // swallowed silently — neither should be reported as an unknown typo,
    // even if absent from the catalog.
    expect(isUnknownRemoteCommand("permissions", catalog)).toBe(false);
    expect(isUnknownRemoteCommand("vim", catalog)).toBe(false);
  });
});
