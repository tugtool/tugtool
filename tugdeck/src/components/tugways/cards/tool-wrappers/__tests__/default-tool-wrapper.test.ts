/**
 * Pure-logic tests for `DefaultToolWrapper`'s output smart-pick, plus
 * the dispatch wiring that routes unknown / audit-confirmed tools to
 * it.
 *
 * `DefaultToolWrapper` is decoration over composition
 * (`ToolWrapperChrome` + two body-kind sections) — its only branching
 * logic is `pickOutputBody`, the [D11] smart-pick. The suite pins:
 *
 *  - `pickOutputBody` — object / array `structured_result` → the
 *    `json` branch (→ `JsonTreeBlock`); plain-text output → the
 *    `markdown` branch (→ `TugMarkdownBlock`); structured wins over
 *    text; neither → `none`. This is the "object output renders via
 *    JsonTreeBlock / text output renders via TugMarkdownBlock" gate.
 *  - the dispatch routes a synthetic unknown `tool_use` to
 *    `DefaultToolWrapper` *with* an `unknown_tool` caution, and an
 *    audit-confirmed long-tail tool to `DefaultToolWrapper` *without*
 *    a caution.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  DefaultToolWrapper,
  pickOutputBody,
} from "../default-tool-wrapper";
import { dispatchToolCallState } from "../../tide-assistant-renderer-dispatch";
import type { ToolCallState } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// pickOutputBody — the [D11] smart-pick
// ---------------------------------------------------------------------------

describe("pickOutputBody", () => {
  test("an object structured_result is the json branch", () => {
    expect(pickOutputBody({ ok: true, items: [1, 2] }, undefined)).toEqual({
      kind: "json",
      data: { ok: true, items: [1, 2] },
    });
  });

  test("an array structured_result is the json branch", () => {
    expect(pickOutputBody([{ id: 1 }], undefined)).toEqual({
      kind: "json",
      data: [{ id: 1 }],
    });
  });

  test("an object structured_result wins over text output", () => {
    const picked = pickOutputBody({ a: 1 }, "ignored text");
    expect(picked).toEqual({ kind: "json", data: { a: 1 } });
  });

  test("plain text output is the markdown branch when no structured object", () => {
    expect(pickOutputBody(undefined, "hello **world**")).toEqual({
      kind: "markdown",
      text: "hello **world**",
    });
    // `null` structured_result is "no structured result" → fall through.
    expect(pickOutputBody(null, "fallthrough")).toEqual({
      kind: "markdown",
      text: "fallthrough",
    });
  });

  test("a primitive structured_result is NOT the json branch — falls to text", () => {
    // [D11] is "object → JsonTreeBlock"; a bare string/number is not
    // an object, so it falls through to the text branch.
    expect(pickOutputBody("just a string", "the text")).toEqual({
      kind: "markdown",
      text: "the text",
    });
    expect(pickOutputBody(42, undefined)).toEqual({ kind: "none" });
  });

  test("neither output present → none", () => {
    expect(pickOutputBody(undefined, undefined)).toEqual({ kind: "none" });
    expect(pickOutputBody(null, "")).toEqual({ kind: "none" });
  });
});

// ---------------------------------------------------------------------------
// Dispatch wiring — unknown / audit-confirmed → DefaultToolWrapper
// ---------------------------------------------------------------------------

function fakeToolCall(
  toolName: string,
  overrides: Partial<ToolCallState> = {},
): ToolCallState {
  return {
    toolUseId: "tu-1",
    toolName,
    input: {},
    status: "done",
    result: null,
    structuredResult: null,
    ...overrides,
  };
}

describe("dispatch → DefaultToolWrapper", () => {
  test("a synthetic unknown tool routes to DefaultToolWrapper with a caution", () => {
    const result = dispatchToolCallState(fakeToolCall("ZzzUnknown"), "m1");
    expect(result.Component).toBe(DefaultToolWrapper);
    expect(result.caution).toEqual({
      reason: "unknown_tool",
      detail: "ZzzUnknown",
    });
    // The caution is also threaded onto the wrapper's props so the
    // chrome can paint the inline `TideCautionBadge`.
    expect(result.props.caution).toEqual({
      reason: "unknown_tool",
      detail: "ZzzUnknown",
    });
  });

  test("an audit-confirmed long-tail tool routes to DefaultToolWrapper with no caution", () => {
    // `taskupdate` is in `AUDIT_CONFIRMED_DEFAULT_TOOLS` — known to
    // route through Default by design, so no drift caution.
    const result = dispatchToolCallState(fakeToolCall("TaskUpdate"), "m1");
    expect(result.Component).toBe(DefaultToolWrapper);
    expect(result.caution).toBeUndefined();
    expect(result.props.caution).toBeUndefined();
  });
});
