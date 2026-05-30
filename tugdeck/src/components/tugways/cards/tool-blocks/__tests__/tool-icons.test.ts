/**
 * tool-icons — unit tests for the central per-tool icon registry.
 *
 * Pins case-insensitivity, the alias-variant coverage (a wire variant
 * resolves to the same glyph as its canonical wrapper), and the
 * Wrench fallback for unknown names. Pure: asserts on component
 * references, never renders.
 */

import { describe, expect, test } from "bun:test";
import { Search, Shell, Wrench } from "lucide-react";

import { toolIconComponentFor } from "../tool-icons";

describe("toolIconComponentFor", () => {
  test("resolves a known tool, case-insensitively", () => {
    expect(toolIconComponentFor("Bash")).toBe(Shell);
    expect(toolIconComponentFor("bash")).toBe(Shell);
    expect(toolIconComponentFor("BASH")).toBe(Shell);
  });

  test("alias variants resolve to the same glyph as the canonical tool", () => {
    // grep + glob + websearch all share the Search glyph
    expect(toolIconComponentFor("grep")).toBe(Search);
    expect(toolIconComponentFor("glob")).toBe(Search);
    expect(toolIconComponentFor("websearch")).toBe(Search);
    // multiedit shares edit's glyph; task shares agent's
    expect(toolIconComponentFor("multiedit")).toBe(
      toolIconComponentFor("edit"),
    );
    expect(toolIconComponentFor("task")).toBe(toolIconComponentFor("agent"));
    // the cron + worktree + taskmgmt families each collapse to one glyph
    expect(toolIconComponentFor("croncreate")).toBe(
      toolIconComponentFor("cron"),
    );
    expect(toolIconComponentFor("enterworktree")).toBe(
      toolIconComponentFor("worktree"),
    );
    expect(toolIconComponentFor("tasklist")).toBe(
      toolIconComponentFor("taskmgmt"),
    );
  });

  test("falls back to Wrench for an unknown tool", () => {
    expect(toolIconComponentFor("totally-made-up-tool")).toBe(Wrench);
    expect(toolIconComponentFor("")).toBe(Wrench);
  });
});
