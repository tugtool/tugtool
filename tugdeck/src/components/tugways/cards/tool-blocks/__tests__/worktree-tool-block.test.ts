/**
 * Pure-logic tests for `WorktreeToolBlock`'s wire-narrowing + verb /
 * header composition helpers, plus the dispatch alias machinery that
 * routes both `EnterWorktree` and `ExitWorktree` to the same bespoke
 * wrapper through the `enterworktree → worktree` and `exitworktree →
 * worktree` `TOOL_ALIASES` entries.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 *
 * @module components/tugways/cards/tool-blocks/__tests__/worktree-tool-block
 */

import { describe, expect, test } from "bun:test";

import {
  WorktreeToolBlock,
  composeWorktreeHeader,
  composeWorktreeToolName,
  deriveWorktreeVerb,
  narrowWorktreeInput,
} from "../worktree-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../dev-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowWorktreeInput
// ---------------------------------------------------------------------------

describe("narrowWorktreeInput", () => {
  test("keeps the recognised wire fields", () => {
    expect(
      narrowWorktreeInput({
        branch: "feature/x",
        path: "/wt/feature-x",
        worktreeId: "wt-42",
      }),
    ).toEqual({
      branch: "feature/x",
      path: "/wt/feature-x",
      worktreeId: "wt-42",
    });
  });

  test("returns {} for non-object input", () => {
    expect(narrowWorktreeInput(null)).toEqual({});
    expect(narrowWorktreeInput([])).toEqual({});
    expect(narrowWorktreeInput("string")).toEqual({});
  });

  test("drops mistyped fields silently", () => {
    expect(
      narrowWorktreeInput({ branch: 1, path: ["x"], worktreeId: true }),
    ).toEqual({
      branch: undefined,
      path: undefined,
      worktreeId: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// deriveWorktreeVerb
// ---------------------------------------------------------------------------

describe("deriveWorktreeVerb", () => {
  test("`EnterWorktree` → enter", () => {
    expect(deriveWorktreeVerb("EnterWorktree")).toBe("enter");
  });

  test("`ExitWorktree` → exit", () => {
    expect(deriveWorktreeVerb("ExitWorktree")).toBe("exit");
  });

  test("case-insensitive", () => {
    expect(deriveWorktreeVerb("enterworktree")).toBe("enter");
    expect(deriveWorktreeVerb("EXITWORKTREE")).toBe("exit");
    expect(deriveWorktreeVerb("enter_worktree")).toBe("enter");
  });

  test("returns null for an unrecognised tool name", () => {
    expect(deriveWorktreeVerb("worktree")).toBeNull();
    expect(deriveWorktreeVerb("PruneWorktree")).toBeNull();
    expect(deriveWorktreeVerb("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composeWorktreeHeader
// ---------------------------------------------------------------------------

describe("composeWorktreeHeader", () => {
  test("prefers branch", () => {
    expect(
      composeWorktreeHeader({
        branch: "feature/x",
        path: "/wt",
        worktreeId: "wt-1",
      }),
    ).toEqual({ label: "feature/x" });
  });

  test("falls back to path", () => {
    expect(composeWorktreeHeader({ path: "/wt/feature-x" }))
      .toEqual({ label: "/wt/feature-x" });
  });

  test("falls back to worktreeId", () => {
    expect(composeWorktreeHeader({ worktreeId: "wt-42" }))
      .toEqual({ label: "wt-42" });
  });

  test("returns undefined when no identifying field is present", () => {
    expect(composeWorktreeHeader({})).toBeUndefined();
  });

  test("ignores empty-string fields", () => {
    expect(composeWorktreeHeader({ branch: "", path: "/wt" }))
      .toEqual({ label: "/wt" });
  });
});

// ---------------------------------------------------------------------------
// composeWorktreeToolName
// ---------------------------------------------------------------------------

describe("composeWorktreeToolName", () => {
  test("`enter` verb → `Worktree · enter`", () => {
    expect(composeWorktreeToolName("enter")).toBe("Worktree · enter");
  });

  test("`exit` verb → `Worktree · exit`", () => {
    expect(composeWorktreeToolName("exit")).toBe("Worktree · exit");
  });

  test("null verb → bare `Worktree`", () => {
    expect(composeWorktreeToolName(null)).toBe("Worktree");
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration — the canonical `worktree` name maps to
// `WorktreeToolBlock` in the frozen `BESPOKE_FACTORY_BY_NAME` lookup.
// The alias map (`enterworktree`/`exitworktree` → `worktree`) lives
// in the dispatch and is exercised at runtime; calling
// `resolveToolBlock` here would race with the dispatch test's
// `beforeEach` (see `skill-tool-block.test.ts` for the rationale).
// The full alias-resolution path is verified by the policy governance
// test's v2.1.148 coverage check, which mirrors `TOOL_ALIASES`
// locally.
// ---------------------------------------------------------------------------

describe("dispatch registration", () => {
  test("`worktree` maps to the bespoke wrapper in the immutable lookup", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("worktree")).toBe(WorktreeToolBlock);
  });

  test("`enterworktree` and `exitworktree` are NOT directly registered (they resolve via alias)", () => {
    // Sanity: the aliases live in `TOOL_ALIASES`, NOT in
    // `BESPOKE_FACTORY_BY_NAME`. If either showed up here, someone
    // accidentally double-registered.
    expect(BESPOKE_FACTORY_BY_NAME.has("enterworktree")).toBe(false);
    expect(BESPOKE_FACTORY_BY_NAME.has("exitworktree")).toBe(false);
  });
});
