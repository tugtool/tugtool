/**
 * denials.test.ts — pure-logic coverage for the Recently-denied feed's
 * decode + accumulate helpers.
 */

import { describe, expect, test } from "bun:test";
import {
  decodePermissionDenials,
  mergeDenials,
} from "@/lib/code-session-store/denials";

describe("decodePermissionDenials", () => {
  test("decodes snake_case entries to camelCase, skipping invalid ones", () => {
    expect(
      decodePermissionDenials([
        { tool_name: "Bash", tool_use_id: "a", tool_input: { command: "x" } },
        { tool_name: "WebFetch", tool_use_id: "b" }, // no tool_input → {}
        { tool_name: "", tool_use_id: "c" }, // empty name → skip
        { tool_use_id: "d" }, // missing name → skip
        "nope", // not an object → skip
      ]),
    ).toEqual([
      { toolName: "Bash", toolUseId: "a", toolInput: { command: "x" } },
      { toolName: "WebFetch", toolUseId: "b", toolInput: {} },
    ]);
  });

  test("a non-array payload yields []", () => {
    expect(decodePermissionDenials(undefined)).toEqual([]);
    expect(decodePermissionDenials(null)).toEqual([]);
    expect(decodePermissionDenials({})).toEqual([]);
  });
});

describe("mergeDenials", () => {
  const a = { toolName: "Bash", toolUseId: "a", toolInput: {} };
  const b = { toolName: "Bash", toolUseId: "b", toolInput: {} };

  test("appends fresh entries, deduping by toolUseId, most-recent last", () => {
    expect(mergeDenials([a], [a, b]).map((d) => d.toolUseId)).toEqual(["a", "b"]);
  });

  test("returns the same reference when nothing new lands ([L02] stability)", () => {
    const existing = [a];
    expect(mergeDenials(existing, [a])).toBe(existing);
    expect(mergeDenials(existing, [])).toBe(existing);
  });
});
