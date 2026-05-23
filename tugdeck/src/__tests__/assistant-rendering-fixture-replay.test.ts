/**
 * Day-1 integration checkpoint ([#step-14]) — fixture-replay of the
 * stream-json catalog through the assistant-rendering *dispatch*.
 *
 * ## Why this is a `.ts`, not the `.tsx` Spec S06 describes
 *
 * Spec S06 ([#s06-fixture-replay]) was written when fake-DOM unit
 * tests were possible: it describes mounting a Tide card per fixture
 * and asserting against the *rendered DOM* ("no `[object Object]`",
 * "no raw JSON bleed", "exactly one `-tool-block` element"). Since
 * then `happy-dom` was deleted and the project's testing policy is
 * **pure-logic `bun:test` + real-app tests only** — there is no
 * fake-DOM render path. Spec S06's render-level assertions (its items
 * 2–4) therefore belong to a render surface: [#step-14-5]'s gallery
 * snapshot tests (which mount real gallery cards) and, for live
 * transcript rendering, a real-app-test once the harness can inject
 * tool-result events (the same gap that gated the find AT-series —
 * see [#e12-followups]).
 *
 * What *is* a pure-logic concern, and what this file pins, is the
 * **dispatch routing contract** — Spec S06 items 1, 5, 6:
 *
 *  1. Every `tool_use` event in the v2.1.105 catalog dispatches
 *     without throwing (`dispatchToolCallState` is a pure, total
 *     function).
 *  5. Tool names with a bespoke wrapper ([Table T02], shipped through
 *     [#step-13]) route to that wrapper; every other name — and the
 *     empty-name streaming-open events — route to `DefaultToolBlock`.
 *  6. A drift caution is raised exactly when a tool routed to
 *     `DefaultToolBlock` for an *unknown* reason (not registered,
 *     not audit-confirmed); a bespoke-routed tool never carries one.
 *
 * The catalog is walked via `listGoldenProbes` / `loadGoldenProbe`,
 * the same loader the `code-session-store` golden tests use — so this
 * test sees exactly the bytes live Claude produced on capture.
 *
 * Scope: v2.1.105 only, per the Step 14 task. `CATALOG_VERSIONS` is a
 * list so [#step-30] (phase-exit checkpoint) appends `"v2.1.112"`.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  listGoldenProbes,
  loadGoldenProbe,
} from "@/lib/code-session-store/testing/golden-catalog";
import {
  _resetToolBlockRegistryForTests,
  dispatchToolCallState,
  registerToolBlock,
  resolveToolBlock,
} from "@/components/tugways/cards/tide-assistant-renderer-dispatch";
import { BashToolBlock } from "@/components/tugways/cards/tool-blocks/bash-tool-block";
import { ReadToolBlock } from "@/components/tugways/cards/tool-blocks/read-tool-block";
import { EditToolBlock } from "@/components/tugways/cards/tool-blocks/edit-tool-block";
import { GlobToolBlock } from "@/components/tugways/cards/tool-blocks/glob-tool-block";
import { GrepToolBlock } from "@/components/tugways/cards/tool-blocks/grep-tool-block";
import { TaskToolBlock } from "@/components/tugways/cards/tool-blocks/task-tool-block";
import { DefaultToolBlock } from "@/components/tugways/cards/tool-blocks/default-tool-block";
import type { ToolBlockFactory } from "@/components/tugways/cards/tool-blocks/types";
import type { ToolCallState } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Catalog scope + expected routing
// ---------------------------------------------------------------------------

/** Catalog versions this checkpoint replays. [#step-30] appends `"v2.1.112"`. */
const CATALOG_VERSIONS = ["v2.1.105"] as const;

/**
 * The bespoke wrappers shipped through [#step-13], keyed by lowercased
 * canonical tool name (including the `multiedit → edit` alias, [D16]).
 * Every other tool name — and the empty-name streaming-open `tool_use`
 * events — falls through to `DefaultToolBlock`.
 */
const BESPOKE_WRAPPERS: Readonly<Record<string, ToolBlockFactory>> = {
  bash: BashToolBlock,
  read: ReadToolBlock,
  edit: EditToolBlock,
  multiedit: EditToolBlock,
  glob: GlobToolBlock,
  grep: GrepToolBlock,
  agent: TaskToolBlock,
  task: TaskToolBlock,
};

/** The wrapper a given tool name should dispatch to today. */
function expectedWrapper(toolName: string): ToolBlockFactory {
  return BESPOKE_WRAPPERS[toolName.toLowerCase()] ?? DefaultToolBlock;
}

/**
 * Build a minimal `ToolCallState` from a fixture `tool_use` event.
 * Dispatch *routing* consults only `toolName`; the other fields are
 * filled with inert defaults so `dispatchToolCallState` composes its
 * `baseProps` without reaching for anything the catalog event lacks.
 */
function toolCallFromEvent(ev: Record<string, unknown>): ToolCallState {
  return {
    toolUseId: typeof ev.tool_use_id === "string" ? ev.tool_use_id : "tu",
    toolName: typeof ev.tool_name === "string" ? ev.tool_name : "",
    input: ev.input ?? {},
    status: "done",
    result: null,
    structuredResult: null,
    toolWallMs: null,
  };
}

// ---------------------------------------------------------------------------
// Hermetic registry — bun shares module state across test files, and
// `tide-assistant-renderer-dispatch.test.ts` resets the registry in its
// own `beforeEach`. Re-establish the real registrations so this file's
// routing assertions are deterministic regardless of file order.
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetToolBlockRegistryForTests();
  registerToolBlock("bash", BashToolBlock);
  registerToolBlock("read", ReadToolBlock);
  registerToolBlock("edit", EditToolBlock);
  registerToolBlock("glob", GlobToolBlock);
  registerToolBlock("grep", GrepToolBlock);
  registerToolBlock("agent", TaskToolBlock);
});

// ---------------------------------------------------------------------------
// Per-catalog, per-probe replay — routing contract (Spec S06 items 1/5/6)
// ---------------------------------------------------------------------------

describe("assistant-rendering fixture replay — dispatch routing", () => {
  for (const version of CATALOG_VERSIONS) {
    const probeNames = listGoldenProbes(version);

    test(`${version}: catalog exposes loadable probes`, () => {
      expect(probeNames.length).toBeGreaterThan(0);
    });

    for (const probeName of probeNames) {
      test(`${version}/${probeName}: every tool_use routes without throwing`, () => {
        // `loadGoldenProbe` throwing here IS the failure — a probe
        // that no longer parses is a real catalog/loader regression.
        const probe = loadGoldenProbe(version, probeName);
        const toolUses = probe.events.filter((e) => e.type === "tool_use");

        for (const ev of toolUses) {
          const toolCall = toolCallFromEvent(ev);
          const result = dispatchToolCallState(toolCall, "msg-replay");

          // Item 5 — the dispatched component matches the routing
          // table: bespoke for Table T02 tools, DefaultToolBlock
          // for the rest.
          expect(result.Component).toBe(expectedWrapper(toolCall.toolName));

          // Item 6 — caution invariant. A caution is raised only for a
          // DefaultToolBlock route, and only with the `unknown_tool`
          // reason; a bespoke-routed tool never carries one. (The
          // dispatch suppresses the flag for audit-confirmed
          // default-routed tools, so "DefaultToolBlock" does not
          // imply a caution — but "has a caution" does imply
          // DefaultToolBlock.)
          if (result.Component === DefaultToolBlock) {
            if (result.caution !== undefined) {
              expect(result.caution.reason).toBe("unknown_tool");
              expect(result.props.caution).toEqual(result.caution);
            }
          } else {
            expect(result.caution).toBeUndefined();
          }
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Shipped-wrapper coverage + synthetic unknown-tool drift
// ---------------------------------------------------------------------------

describe("assistant-rendering fixture replay — shipped wrapper coverage", () => {
  test("Bash / Read / Edit / MultiEdit / Glob / Grep / Agent resolve to their bespoke wrappers", () => {
    // Edit has no v2.1.105 catalog fixture, so its routing is pinned
    // here directly (and via `edit-tool-block.test.ts`'s alias test).
    expect(resolveToolBlock("Bash")).toBe(BashToolBlock);
    expect(resolveToolBlock("bash")).toBe(BashToolBlock);
    expect(resolveToolBlock("Read")).toBe(ReadToolBlock);
    expect(resolveToolBlock("Edit")).toBe(EditToolBlock);
    expect(resolveToolBlock("MultiEdit")).toBe(EditToolBlock);
    expect(resolveToolBlock("Glob")).toBe(GlobToolBlock);
    expect(resolveToolBlock("glob")).toBe(GlobToolBlock);
    expect(resolveToolBlock("Grep")).toBe(GrepToolBlock);
    expect(resolveToolBlock("grep")).toBe(GrepToolBlock);
    // `Agent` is canonical; the historical `Task` name resolves here
    // via the `task → agent` alias ([D16]).
    expect(resolveToolBlock("Agent")).toBe(TaskToolBlock);
    expect(resolveToolBlock("agent")).toBe(TaskToolBlock);
    expect(resolveToolBlock("Task")).toBe(TaskToolBlock);
  });

  test("a synthetic unknown-tool dispatch raises an unknown_tool caution", () => {
    const result = dispatchToolCallState(
      {
        toolUseId: "tu-synthetic",
        toolName: "ZzzSyntheticUnknownTool",
        input: {},
        status: "done",
        result: null,
        structuredResult: null,
        toolWallMs: null,
      },
      "msg-replay",
    );
    expect(result.Component).toBe(DefaultToolBlock);
    expect(result.caution).toEqual({
      reason: "unknown_tool",
      detail: "ZzzSyntheticUnknownTool",
    });
    // The caution is threaded onto the wrapper props so the chrome
    // paints the inline `TideCautionBadge`.
    expect(result.props.caution).toEqual(result.caution);
  });
});
