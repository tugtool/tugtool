/**
 * Pure-logic tests for `SkillToolBlock`'s wire-narrowing + header /
 * result composition helpers, plus the dispatch-registry entry that
 * makes `Skill` route through the bespoke wrapper.
 *
 * The wrapper itself is decoration over composition (`ToolBlockChrome`
 * + a few primitives) — its behaviour is the four exported helpers:
 *
 *  - `narrowSkillInput` — defensive narrowing of the `unknown` wire
 *    input.
 *  - `composeSkillHeaderArgs` — picks the args-summary label from
 *    the input's `skill` field.
 *  - `pickSkillResultPresentation` — decides whether the result
 *    surfaces as a one-line label, with the short-string guard.
 *  - the `skill` registration resolves to `SkillToolBlock`.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 *
 * @module components/tugways/cards/tool-blocks/__tests__/skill-tool-block
 */

import { describe, expect, test } from "bun:test";

import {
  INLINE_ARGS_MAX_CHARS,
  ONE_LINE_RESULT_MAX_CHARS,
  SkillToolBlock,
  composeSkillHeaderArgs,
  narrowSkillInput,
  pickSkillResultPresentation,
} from "../skill-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../tide-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowSkillInput
// ---------------------------------------------------------------------------

describe("narrowSkillInput", () => {
  test("keeps `skill` + `args` when well-typed", () => {
    expect(narrowSkillInput({ skill: "commit", args: "feat: new thing" }))
      .toEqual({ skill: "commit", args: "feat: new thing" });
  });

  test("returns {} for non-object input", () => {
    expect(narrowSkillInput(null)).toEqual({});
    expect(narrowSkillInput(undefined)).toEqual({});
    expect(narrowSkillInput("string")).toEqual({});
    expect(narrowSkillInput(42)).toEqual({});
  });

  test("drops mistyped fields silently", () => {
    expect(narrowSkillInput({ skill: 123, args: ["a", "b"] }))
      .toEqual({ skill: undefined, args: undefined });
  });

  test("omits absent fields", () => {
    expect(narrowSkillInput({ skill: "review" }))
      .toEqual({ skill: "review", args: undefined });
  });
});

// ---------------------------------------------------------------------------
// composeSkillHeaderArgs
// ---------------------------------------------------------------------------

describe("composeSkillHeaderArgs", () => {
  test("returns `/<skill>` for a present skill", () => {
    expect(composeSkillHeaderArgs("commit"))
      .toEqual({ label: "/commit" });
  });

  test("returns undefined when skill is undefined or empty", () => {
    expect(composeSkillHeaderArgs(undefined)).toBeUndefined();
    expect(composeSkillHeaderArgs("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pickSkillResultPresentation
// ---------------------------------------------------------------------------

describe("pickSkillResultPresentation", () => {
  test("returns `none` for non-ready statuses", () => {
    expect(pickSkillResultPresentation("hello", "streaming"))
      .toEqual({ kind: "none" });
    expect(pickSkillResultPresentation("hello", "error"))
      .toEqual({ kind: "none" });
  });

  test("returns `none` for undefined / empty / whitespace-only text", () => {
    expect(pickSkillResultPresentation(undefined, "ready"))
      .toEqual({ kind: "none" });
    expect(pickSkillResultPresentation("", "ready"))
      .toEqual({ kind: "none" });
    expect(pickSkillResultPresentation("   \n  \t ", "ready"))
      .toEqual({ kind: "none" });
  });

  test("returns `label` with the trimmed text for short results", () => {
    expect(pickSkillResultPresentation("  done  ", "ready"))
      .toEqual({ kind: "label", text: "done" });
  });

  test("returns `none` for results that exceed the one-line cap", () => {
    const long = "x".repeat(ONE_LINE_RESULT_MAX_CHARS + 1);
    expect(pickSkillResultPresentation(long, "ready"))
      .toEqual({ kind: "none" });
  });
});

// ---------------------------------------------------------------------------
// Inline-args breakpoint — pin the constant so a future tweak surfaces
// in code review.
// ---------------------------------------------------------------------------

describe("INLINE_ARGS_MAX_CHARS", () => {
  test("80-char breakpoint", () => {
    // 80 was picked to match the conventional terminal-width
    // breakpoint; the test asserts the value so a silent change
    // surfaces in review.
    expect(INLINE_ARGS_MAX_CHARS).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration — `skill` maps to `SkillToolBlock` in the
// frozen `BESPOKE_FACTORY_BY_NAME` lookup. We deliberately do NOT
// call `resolveToolBlock` here because the dispatch test file's
// `beforeEach` clears the runtime registry, and bun runs each test
// file's tests before loading the next; a runtime resolution call
// would race with that lifecycle.
// ---------------------------------------------------------------------------

describe("dispatch registration", () => {
  test("`skill` maps to the bespoke wrapper in the immutable lookup", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("skill")).toBe(SkillToolBlock);
  });
});
