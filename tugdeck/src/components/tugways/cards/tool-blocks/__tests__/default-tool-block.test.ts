/**
 * Pure-logic tests for `DefaultToolBlock`'s output smart-pick, plus
 * the dispatch wiring that routes unknown / audit-confirmed tools to
 * it.
 *
 * `DefaultToolBlock` is decoration over composition
 * (`ToolBlockChrome` + two body-kind sections) — its only branching
 * logic is `pickOutputBody`, the [D11] smart-pick. The suite pins:
 *
 *  - `pickOutputBody` — object / array `structured_result` → the
 *    `json` branch (→ `JsonTreeBlock`); plain-text output → the
 *    `markdown` branch (→ `TugMarkdownBlock`); structured wins over
 *    text; neither → `none`. This is the "object output renders via
 *    JsonTreeBlock / text output renders via TugMarkdownBlock" gate.
 *  - the dispatch routes a synthetic unknown `tool_use` to
 *    `DefaultToolBlock` *with* an `unknown_tool` caution, and an
 *    audit-confirmed long-tail tool to `DefaultToolBlock` *without*
 *    a caution.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  DefaultToolBlock,
  pickOutputBody,
} from "../default-tool-block";
import { dispatchToolCallState } from "../../tide-assistant-renderer-dispatch";
import { defaultIntentToolNames } from "../../tide-tool-visibility-policy";
import type { ToolUseMessage } from "@/lib/code-session-store";

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
// Dispatch wiring — unknown / audit-confirmed → DefaultToolBlock
// ---------------------------------------------------------------------------

function fakeToolCall(
  toolName: string,
  overrides: Partial<ToolUseMessage> = {},
): ToolUseMessage {
  return {
    kind: "tool_use",
    messageKey: "tu-1-msg",
    createdAt: 0,
    toolUseId: "tu-1",
    toolName,
    input: {},
    status: "done",
    result: null,
    structuredResult: null,
    toolWallMs: null,
    ...overrides,
  };
}

describe("dispatch → DefaultToolBlock", () => {
  test("a synthetic unknown tool routes to DefaultToolBlock with a caution", () => {
    const result = dispatchToolCallState(fakeToolCall("ZzzUnknown"));
    expect(result.Component).toBe(DefaultToolBlock);
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

  test("a policy default-intent tool routes to DefaultToolBlock with no caution", () => {
    // Per [D101] policy contract: a tool in the `default-intent`
    // bucket of `TOOL_VISIBILITY_POLICY` routes through
    // `DefaultToolBlock` without raising a drift caution. The set
    // shrinks as bespoke wrappers ship; this canary re-points at
    // whatever name is currently classified default-intent. When
    // the bucket is empty (every tool covered by bespoke), the
    // policy-file invariants carry the contract and this assertion
    // is informational.
    const sample = defaultIntentToolNames().values().next().value;
    if (sample === undefined) {
      expect(defaultIntentToolNames().size).toBe(0);
      return;
    }
    const result = dispatchToolCallState(fakeToolCall(sample));
    expect(result.Component).toBe(DefaultToolBlock);
    expect(result.caution).toBeUndefined();
    expect(result.props.caution).toBeUndefined();
  });
});
