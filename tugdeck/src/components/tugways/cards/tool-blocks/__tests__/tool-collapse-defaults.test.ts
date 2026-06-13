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
  test("collapses the noisy file/shell tools ([P07])", () => {
    for (const name of ["Read", "Grep", "Glob", "Bash", "Edit", "MultiEdit", "Write"]) {
      expect(collapseDefaultFor(name)).toBe(true);
    }
  });

  test("leaves content-bearing tools expanded ([P07])", () => {
    for (const name of ["Skill", "Agent", "Task", "AskUserQuestion", "WebFetch", "WebSearch"]) {
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
    expect(collapsed).toEqual(["bash", "edit", "glob", "grep", "multiedit", "read", "write"]);
  });
});
