/**
 * Pure-logic tests for `RemoteTriggerToolBlock`'s wire-narrowing +
 * tool-name / args composition + body formatter helpers, plus the
 * dispatch registration pin (`remotetrigger` →
 * `RemoteTriggerToolBlock`).
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 *
 * @module components/tugways/cards/tool-blocks/__tests__/remote-trigger-tool-block
 */

import { describe, expect, test } from "bun:test";

import {
  RemoteTriggerToolBlock,
  composeRemoteTriggerArgsLabel,
  composeRemoteTriggerToolName,
  formatRemoteTriggerBody,
  narrowRemoteTriggerInput,
} from "../remote-trigger-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../dev-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowRemoteTriggerInput
// ---------------------------------------------------------------------------

describe("narrowRemoteTriggerInput", () => {
  test("keeps known actions", () => {
    for (const action of ["list", "get", "create", "update", "run"] as const) {
      expect(narrowRemoteTriggerInput({ action })).toEqual({
        action,
        trigger_id: undefined,
        body: undefined,
      });
    }
  });

  test("keeps trigger_id when non-empty string", () => {
    expect(
      narrowRemoteTriggerInput({ action: "get", trigger_id: "trg-abc" }),
    ).toEqual({
      action: "get",
      trigger_id: "trg-abc",
      body: undefined,
    });
  });

  test("keeps body when it's a plain object", () => {
    expect(
      narrowRemoteTriggerInput({
        action: "create",
        body: { name: "test", schedule: "0 9 * * *" },
      }),
    ).toEqual({
      action: "create",
      trigger_id: undefined,
      body: { name: "test", schedule: "0 9 * * *" },
    });
  });

  test("drops array `body` (only plain objects accepted)", () => {
    expect(
      narrowRemoteTriggerInput({ action: "create", body: [1, 2, 3] }),
    ).toEqual({
      action: "create",
      trigger_id: undefined,
      body: undefined,
    });
  });

  test("drops unrecognised action silently — reads neutrally", () => {
    expect(narrowRemoteTriggerInput({ action: "fly" })).toEqual({
      action: undefined,
      trigger_id: undefined,
      body: undefined,
    });
  });

  test("returns {} for non-object input", () => {
    expect(narrowRemoteTriggerInput(null)).toEqual({});
    expect(narrowRemoteTriggerInput([])).toEqual({});
    expect(narrowRemoteTriggerInput(42)).toEqual({});
  });

  test("drops empty-string trigger_id (treated as absent)", () => {
    expect(
      narrowRemoteTriggerInput({ action: "get", trigger_id: "" }),
    ).toEqual({
      action: "get",
      trigger_id: undefined,
      body: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// composeRemoteTriggerToolName
// ---------------------------------------------------------------------------

describe("composeRemoteTriggerToolName", () => {
  test("with action → `Remote Trigger · <action>`", () => {
    expect(composeRemoteTriggerToolName("list")).toBe("Remote Trigger · list");
    expect(composeRemoteTriggerToolName("get")).toBe("Remote Trigger · get");
    expect(composeRemoteTriggerToolName("create")).toBe("Remote Trigger · create");
    expect(composeRemoteTriggerToolName("update")).toBe("Remote Trigger · update");
    expect(composeRemoteTriggerToolName("run")).toBe("Remote Trigger · run");
  });

  test("undefined action → bare `Remote Trigger`", () => {
    expect(composeRemoteTriggerToolName(undefined)).toBe("Remote Trigger");
  });
});

// ---------------------------------------------------------------------------
// composeRemoteTriggerArgsLabel
// ---------------------------------------------------------------------------

describe("composeRemoteTriggerArgsLabel", () => {
  test("emits `#<trigger_id>` when an id is present", () => {
    expect(
      composeRemoteTriggerArgsLabel({ action: "get", trigger_id: "trg-abc" }),
    ).toEqual({ label: "#trg-abc" });
  });

  test("returns undefined when no id has arrived yet", () => {
    expect(composeRemoteTriggerArgsLabel({})).toBeUndefined();
    expect(composeRemoteTriggerArgsLabel({ action: "list" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatRemoteTriggerBody
// ---------------------------------------------------------------------------

describe("formatRemoteTriggerBody", () => {
  test("pretty-prints with two-space indent", () => {
    const formatted = formatRemoteTriggerBody({
      name: "test",
      schedule: "0 9 * * *",
    });
    expect(formatted).toContain('"name": "test"');
    expect(formatted).toContain('"schedule": "0 9 * * *"');
    // Two-space indent: every body line starts with exactly two spaces.
    const innerLines = formatted.split("\n").slice(1, -1);
    expect(innerLines.length).toBeGreaterThan(0);
    for (const line of innerLines) {
      expect(line.startsWith("  ")).toBe(true);
    }
  });

  test("handles empty object", () => {
    expect(formatRemoteTriggerBody({})).toBe("{}");
  });

  test("falls back to String(value) on cyclic graph", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    // String([object Object]) — defensive fallback, not pretty, but
    // guarantees no throw.
    expect(typeof formatRemoteTriggerBody(cyclic)).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration
// ---------------------------------------------------------------------------

describe("dispatch registration", () => {
  test("`remotetrigger` maps to the bespoke wrapper", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("remotetrigger")).toBe(
      RemoteTriggerToolBlock,
    );
  });
});
