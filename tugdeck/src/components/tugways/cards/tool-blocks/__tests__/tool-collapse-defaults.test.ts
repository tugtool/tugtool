/**
 * tool-collapse-defaults.test.ts — the per-tool collapse-default table
 * ([P06]/[P07]): noisy file/shell tools collapse; content tools expand;
 * unknown tools default expanded; lookup is case-insensitive.
 */

import { describe, expect, test } from "bun:test";
import {
  collapseDefaultFor,
  TOOL_COLLAPSE_DEFAULTS,
} from "../tool-collapse-defaults";

describe("collapseDefaultFor", () => {
  test("collapses the noisy file/shell tools + Agent ([P07])", () => {
    for (const name of [
      "Read", "Grep", "Glob", "Bash", "Edit", "MultiEdit", "Write",
      // An Agent run is noisy nested I/O; its collapsed header (type +
      // description + nested-call-count badge) is self-explanatory. The
      // historical `Task` alias collapses alike.
      "Agent", "Task",
    ]) {
      expect(collapseDefaultFor(name)).toBe(true);
    }
  });

  test("leaves content-bearing tools expanded ([P07])", () => {
    for (const name of ["Skill", "AskUserQuestion", "WebFetch", "WebSearch"]) {
      expect(collapseDefaultFor(name)).toBe(false);
    }
  });

  test("unknown tools default to expanded", () => {
    expect(collapseDefaultFor("SomeFutureTool")).toBe(false);
    expect(collapseDefaultFor("")).toBe(false);
  });

  test("lookup is case-insensitive", () => {
    expect(collapseDefaultFor("BASH")).toBe(true);
    expect(collapseDefaultFor("bash")).toBe(true);
    expect(collapseDefaultFor("ReAd")).toBe(true);
  });

  test("the table seeds exactly the [P07] collapse set as true", () => {
    const collapsed = Object.entries(TOOL_COLLAPSE_DEFAULTS)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort();
    expect(collapsed).toEqual([
      "agent", "bash", "edit", "glob", "grep", "multiedit", "read", "task", "write",
    ]);
  });
});
