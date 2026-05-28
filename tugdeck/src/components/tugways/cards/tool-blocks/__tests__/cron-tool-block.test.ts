/**
 * Pure-logic tests for `CronToolBlock`'s wire-narrowing + verb /
 * header / args composition helpers, plus the dispatch alias
 * machinery that routes all three wire names (`CronCreate` /
 * `CronDelete` / `CronList`) to the canonical `cron` registry entry
 * via `TOOL_ALIASES`.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 *
 * @module components/tugways/cards/tool-blocks/__tests__/cron-tool-block
 */

import { describe, expect, test } from "bun:test";

import {
  CronToolBlock,
  composeCronArgsLabel,
  composeCronToolName,
  deriveCronVerb,
  narrowCronInput,
} from "../cron-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../dev-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowCronInput
// ---------------------------------------------------------------------------

describe("narrowCronInput", () => {
  test("keeps the recognised wire fields", () => {
    expect(
      narrowCronInput({
        cron: "0 9 * * *",
        prompt: "ping",
        durable: true,
        recurring: false,
        id: "cron-abc",
      }),
    ).toEqual({
      cron: "0 9 * * *",
      prompt: "ping",
      durable: true,
      recurring: false,
      id: "cron-abc",
    });
  });

  test("returns {} for non-object input", () => {
    expect(narrowCronInput(null)).toEqual({});
    expect(narrowCronInput([])).toEqual({});
    expect(narrowCronInput("string")).toEqual({});
  });

  test("drops mistyped fields silently", () => {
    expect(
      narrowCronInput({ cron: 1, prompt: false, durable: "yes", id: 99 }),
    ).toEqual({
      cron: undefined,
      prompt: undefined,
      durable: undefined,
      recurring: undefined,
      id: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// deriveCronVerb
// ---------------------------------------------------------------------------

describe("deriveCronVerb", () => {
  test("`CronCreate` → create", () => {
    expect(deriveCronVerb("CronCreate")).toBe("create");
  });

  test("`CronDelete` → delete", () => {
    expect(deriveCronVerb("CronDelete")).toBe("delete");
  });

  test("`CronList` → list", () => {
    expect(deriveCronVerb("CronList")).toBe("list");
  });

  test("case-insensitive and tolerant of separators", () => {
    expect(deriveCronVerb("croncreate")).toBe("create");
    expect(deriveCronVerb("CRONDELETE")).toBe("delete");
    expect(deriveCronVerb("cron_list")).toBe("list");
    expect(deriveCronVerb("cron-create")).toBe("create");
  });

  test("returns null for an unrecognised tool name", () => {
    expect(deriveCronVerb("Cron")).toBeNull();
    expect(deriveCronVerb("CronGet")).toBeNull();
    expect(deriveCronVerb("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composeCronToolName
// ---------------------------------------------------------------------------

describe("composeCronToolName", () => {
  test("verb-qualified header strings", () => {
    expect(composeCronToolName("create")).toBe("Cron · create");
    expect(composeCronToolName("delete")).toBe("Cron · delete");
    expect(composeCronToolName("list")).toBe("Cron · list");
  });

  test("null verb → bare `Cron`", () => {
    expect(composeCronToolName(null)).toBe("Cron");
  });
});

// ---------------------------------------------------------------------------
// composeCronArgsLabel
// ---------------------------------------------------------------------------

describe("composeCronArgsLabel", () => {
  test("create → cron expression", () => {
    expect(composeCronArgsLabel("create", { cron: "0 9 * * *" })).toEqual({
      label: "0 9 * * *",
    });
  });

  test("delete → `#<id>`", () => {
    expect(composeCronArgsLabel("delete", { id: "cron-abc" })).toEqual({
      label: "#cron-abc",
    });
  });

  test("list → undefined (no args slot)", () => {
    expect(composeCronArgsLabel("list", {})).toBeUndefined();
  });

  test("returns undefined when no relevant field arrived yet", () => {
    expect(composeCronArgsLabel("create", {})).toBeUndefined();
    expect(composeCronArgsLabel("delete", {})).toBeUndefined();
  });

  test("returns undefined for null verb (defensive)", () => {
    expect(composeCronArgsLabel(null, { cron: "0 9 * * *" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration
// ---------------------------------------------------------------------------

describe("dispatch registration", () => {
  test("`cron` maps to the bespoke wrapper in the immutable lookup", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("cron")).toBe(CronToolBlock);
  });

  test("the three wire names are NOT directly registered (resolve via alias)", () => {
    expect(BESPOKE_FACTORY_BY_NAME.has("croncreate")).toBe(false);
    expect(BESPOKE_FACTORY_BY_NAME.has("crondelete")).toBe(false);
    expect(BESPOKE_FACTORY_BY_NAME.has("cronlist")).toBe(false);
  });
});
