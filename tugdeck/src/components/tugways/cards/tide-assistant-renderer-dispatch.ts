/**
 * tide-assistant-renderer-dispatch.ts — pure routing layer that maps a
 * `RenderInput` (a discriminated union of things-to-render produced by
 * the transcript view from `TurnEntry` fields, in-flight streaming
 * content, and chrome-shaped events) to a renderer component plus
 * props.
 *
 * The dispatch is the seam between `CodeSessionStore` (state) and the
 * Layer-1/Layer-2 rendering tree (presentation). The store stays
 * unchanged by this seam — it produces `TurnEntry` records as it
 * always has — and the transcript view becomes a thin walker that
 * unfolds each turn into the kinds the dispatch knows how to route.
 *
 * # Contract
 *
 * - `dispatch(input, context)` returns `{ Component, props, caution? }`
 *   for any `RenderInput`. It NEVER throws; an unrouteable input falls
 *   back to the scaffold for its kind (for future-proofing) or, for
 *   `tool_call`, to `DefaultToolWrapper` with a caution reason.
 * - `resolveToolWrapper(name)` looks up by lowercased tool name with
 *   alias resolution. Returns `DefaultToolWrapper` for misses.
 * - `registeredTools()` enumerates the canonical names of every
 *   wrapper in the registry (excluding aliases and the default
 *   fallback). Test-facing.
 *
 * # Registry & aliases
 *
 * The registry is a module-static `Map<string, ToolWrapperFactory>`
 * keyed on lowercased canonical names. The alias map handles
 * historical renames (most importantly `task → agent`, since real
 * Claude Code now emits `Agent` rather than the historical `Task` —
 * see the empirical session audit) and synonyms (`multiedit → edit`).
 *
 * # Drift detection (caution flags)
 *
 * Three drift signals are surfaced as `caution`:
 *  - `unknown_tool` — `tool_call` with a name not in the registry.
 *  - `unknown_shape` — placeholder; full shape validation lands later.
 *  - `version_drift` — placeholder; full version-gate wiring lands
 *    alongside the drift detection step.
 *
 * The unknown-tool flag is suppressed when the name resolves through
 * an alias OR when the name is in the audit-confirmed default-routed
 * list (see `AUDIT_CONFIRMED_DEFAULT_TOOLS`) — those tools are *known*
 * to route through `DefaultToolWrapper` by design rather than because
 * they're surprising.
 *
 * # Kind-renderer scaffolds
 *
 * For the kinds whose real renderers haven't shipped yet (`thinking`,
 * `permission`, `question`, `cost`, etc.), the dispatch routes to a
 * tiny `ScaffoldRenderer` that prints `data-slot="scaffold-{kind}"`
 * and the kind name. Each follow-on step replaces its kind's entry in
 * `KIND_RENDERERS` with the real component. The scaffolds make the
 * dispatch wiring testable from day one and the wiring sites cheap to
 * upgrade — the test suite asserts equality against `KIND_RENDERERS`,
 * so the test stays correct as long as the test imports the same
 * symbol.
 *
 * @module components/tugways/cards/tide-assistant-renderer-dispatch
 */

import React from "react";

import type { PropertyStore } from "@/components/tugways/property-store";
import type {
  CodeSessionStore,
  ControlRequestForward,
  CostSnapshot,
  ToolCallState,
} from "@/lib/code-session-store";

import { BashToolBlock } from "./tool-wrappers/bash-tool-block";
import { ReadToolBlock } from "./tool-wrappers/read-tool-block";
import { EditToolBlock } from "./tool-wrappers/edit-tool-block";
import { GlobToolBlock } from "./tool-wrappers/glob-tool-block";
import { GrepToolBlock } from "./tool-wrappers/grep-tool-block";
import { DefaultToolWrapper } from "./tool-wrappers/default-tool-wrapper";
import type { CautionFlag, ToolWrapperFactory } from "./tool-wrappers/types";

// ---------------------------------------------------------------------------
// RenderInput — discriminated union the dispatch routes.
// ---------------------------------------------------------------------------

/**
 * Discriminated input for the dispatch. Each kind is produced by the
 * transcript view from a specific source: TurnEntry fields, in-flight
 * streaming content, or chrome-shaped events.
 */
export type RenderInput =
  | {
      kind: "assistant_text";
      text: string;
      status: "streaming" | "complete";
      msgId: string;
    }
  | {
      kind: "thinking";
      text: string;
      status: "streaming" | "complete";
      msgId: string;
    }
  | {
      kind: "tool_call";
      toolCall: ToolCallState;
      msgId: string;
    }
  | {
      kind: "user_text";
      text: string;
      submitAt: number;
    }
  | {
      kind: "permission";
      request: ControlRequestForward;
    }
  | {
      kind: "question";
      request: ControlRequestForward;
    }
  | {
      kind: "cost";
      cost: CostSnapshot;
      cumulative?: CostSnapshot;
    }
  | {
      kind: "system_metadata";
      metadata: unknown;
      previousMetadata?: unknown;
    }
  | {
      kind: "error";
      message: string;
      recoverable: boolean;
    };

export type RenderInputKind = RenderInput["kind"];

// ---------------------------------------------------------------------------
// DispatchResult, DispatchContext.
// ---------------------------------------------------------------------------

/**
 * The dispatch's return value. `Component` is the React component to
 * mount; `props` is the prop bag. `caution` is set when the dispatch
 * detected drift (unknown tool, etc.); the consumer surfaces it as an
 * inline badge plus an aggregate counter on the card chrome.
 *
 * `Component`'s prop type is `any` by design: the dispatch is opaque
 * over the prop shape — every kind has its own renderer, every tool
 * wrapper has its own (registry-supplied) prop interface, and the
 * dispatch's job is just to hand back a matched (Component, props)
 * pair that the consumer mounts as `<Component {...props} />`. A
 * narrower type would force an artificial common interface on
 * unrelated renderers, and the spec ([Spec S01]) was always written
 * this way for that reason.
 */
export interface DispatchResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: React.ComponentType<any>;
  props: Record<string, unknown>;
  caution?: CautionFlag;
}

/**
 * Context passed into `dispatch`. Contains the per-card streaming
 * `PropertyStore` (consumed by streaming-binding bodies) and the
 * `CodeSessionStore` handle (read-only access for renderers that
 * need it). `depth` is for `AgentTranscriptBlock` recursion.
 *
 * `previousMetadata` for the on-change comparison rides on the
 * `system_metadata` `RenderInput` itself, not on this context — so
 * the dispatch is fully stateless across calls.
 */
export interface DispatchContext {
  store: PropertyStore;
  session: CodeSessionStore;
  depth?: number;
}

// ---------------------------------------------------------------------------
// Tool-wrapper registry and aliases.
// ---------------------------------------------------------------------------

/**
 * Module-static registry. Keys are lowercased canonical tool names.
 * Real per-tool wrappers register themselves via `registerToolWrapper`
 * as they ship (BashToolBlock at #step-6, ReadToolBlock at #step-8,
 * EditToolBlock at #step-11 — `multiedit` aliases to it — etc.). Until
 * they ship, the registry contains only the audit-confirmed routes —
 * every `tool_call` not in the registry lands on `DefaultToolWrapper`
 * with a caution flag.
 */
const TOOL_WRAPPER_REGISTRY = new Map<string, ToolWrapperFactory>();

/**
 * Tool-name aliases — historical renames and synonyms that should
 * resolve to a canonical wrapper. Keys and values are lowercased.
 *
 * Entries:
 *  - `task` → `agent`: Claude Code renamed its `Task` tool to `Agent`;
 *    the empirical session audit confirms current sessions emit
 *    `Agent`, so `task` is a backward-compat alias.
 *  - `multiedit` → `edit`: a single Edit wrapper renders both the
 *    Edit and MultiEdit tools (per Table T02).
 */
const TOOL_ALIASES: ReadonlyMap<string, string> = new Map([
  ["task", "agent"],
  ["multiedit", "edit"],
]);

/**
 * Audit-confirmed tool names that route through `DefaultToolWrapper`
 * by design. These suppress the `unknown_tool` caution because they
 * are *known* tools whose JsonTree-based default rendering is
 * sufficient — they appeared in the empirical session audit and were
 * scoped to Default rather than getting bespoke wrappers.
 *
 * Promote an entry from here to `TOOL_WRAPPER_REGISTRY` later if
 * dogfooding shows the default rendering is suboptimal.
 */
const AUDIT_CONFIRMED_DEFAULT_TOOLS: ReadonlySet<string> = new Set([
  // Background-task management family (TaskUpdate alone is 5.33% of all tool calls)
  "taskcreate",
  "taskupdate",
  "tasklist",
  "taskoutput",
  "taskstop",
  // Long tail
  "monitor",
  "skill",
  "schedulewakeup",
  "toolsearch",
  "enterworktree",
  "exitworktree",
]);

/**
 * Register a tool wrapper. Called by tool-wrapper modules at import
 * time as they ship. The name is lowercased before insertion so the
 * registry key vocabulary is uniform.
 *
 * Idempotent: re-registering the same name overwrites the existing
 * entry, which is the right behavior for HMR and for tests that need
 * to swap a wrapper out.
 */
export function registerToolWrapper(
  name: string,
  factory: ToolWrapperFactory,
): void {
  TOOL_WRAPPER_REGISTRY.set(name.toLowerCase(), factory);
}

/**
 * Test-only: clear the registry. Used by the dispatch test to start
 * each test from a known empty state. Production code never calls
 * this.
 */
export function _resetToolWrapperRegistryForTests(): void {
  TOOL_WRAPPER_REGISTRY.clear();
}

/**
 * Resolve a tool wrapper by name. Case-insensitive. Aliases are
 * resolved before lookup. Returns `DefaultToolWrapper` for misses —
 * never returns `undefined`.
 */
export function resolveToolWrapper(toolName: string): ToolWrapperFactory {
  const lower = toolName.toLowerCase();
  const canonical = TOOL_ALIASES.get(lower) ?? lower;
  return TOOL_WRAPPER_REGISTRY.get(canonical) ?? DefaultToolWrapper;
}

/**
 * Enumerate the canonical names of every registered wrapper. Aliases
 * and `DefaultToolWrapper` are NOT included — only the wrappers that
 * are explicitly registered. The test suite uses this to verify the
 * registry's coverage matches Table T02 at phase exit.
 */
export function registeredTools(): ReadonlyArray<string> {
  return Array.from(TOOL_WRAPPER_REGISTRY.keys()).sort();
}

// ---------------------------------------------------------------------------
// Kind-renderer scaffolds.
//
// Each entry in `KIND_RENDERERS` is the renderer for one `RenderInput`
// kind. Today most are scaffolds — small functional components that
// render an inert `data-slot` div. Each follow-on step replaces its
// kind's entry with the real renderer:
//
//   assistant_text → real component lands at #step-3 (markdown extensions
//                    + transformer pass — assistant text is rendered via
//                    the existing TugMarkdownBlock; the AssistantTurnRenderer
//                    is the chrome wrapper around it)
//   thinking       → ThinkingBlock at #step-4
//   tool_call      → handled separately via the registry — never via
//                    KIND_RENDERERS
//   user_text      → existing user-row primitive (no separate renderer
//                    needed; routes here for symmetry)
//   permission     → PermissionDialog at #step-18
//   question       → QuestionDialog at #step-19
//   cost           → CostChrome at #step-20
//   system_metadata→ SessionInitBanner at #step-29
//   error          → ErrorBlock at #step-29
// ---------------------------------------------------------------------------

/**
 * Scaffold renderer factory. Returns a named functional component that
 * prints `data-slot="scaffold-{kind}"` plus the kind label. Each kind
 * that doesn't have a real renderer yet uses one of these so the
 * dispatch wiring is exercisable and the test suite can assert
 * Component reference equality against `KIND_RENDERERS[kind]`.
 *
 * The displayName is set so React DevTools shows the kind name —
 * helpful when debugging an unwired path before the real renderer
 * lands.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeScaffoldRenderer(kind: RenderInputKind): React.ComponentType<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Component: React.FC<any> = () => {
    return React.createElement("div", {
      "data-slot": `scaffold-${kind}`,
    });
  };
  Component.displayName = `Scaffold(${kind})`;
  return Component;
}

/**
 * Per-kind renderer table. Tests assert against entries here. As real
 * renderers ship, each step replaces its entry with the real
 * component reference.
 *
 * `tool_call` is intentionally omitted because tool-call dispatch
 * goes through `resolveToolWrapper` — every tool routes through
 * either a registered wrapper or `DefaultToolWrapper`, so there's no
 * meaningful kind-level scaffold for it.
 */
export const KIND_RENDERERS: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [K in Exclude<RenderInputKind, "tool_call">]: React.ComponentType<any>;
} = {
  assistant_text: makeScaffoldRenderer("assistant_text"),
  thinking: makeScaffoldRenderer("thinking"),
  user_text: makeScaffoldRenderer("user_text"),
  permission: makeScaffoldRenderer("permission"),
  question: makeScaffoldRenderer("question"),
  cost: makeScaffoldRenderer("cost"),
  system_metadata: makeScaffoldRenderer("system_metadata"),
  error: makeScaffoldRenderer("error"),
};

// ---------------------------------------------------------------------------
// dispatch — the load-bearing routing function.
// ---------------------------------------------------------------------------

/**
 * Route a `RenderInput` to a renderer + props. Pure function over the
 * static registry; never throws. Returns `caution` when drift is
 * detected.
 */
export function dispatch(
  input: RenderInput,
  context: DispatchContext,
): DispatchResult {
  if (input.kind === "tool_call") {
    return dispatchToolCallState(input.toolCall, input.msgId);
  }
  // Everything else routes through KIND_RENDERERS. The exhaustive
  // check below makes this branch type-safe — every kind in
  // RenderInput must have a corresponding entry.
  const Component = KIND_RENDERERS[input.kind];
  return {
    Component,
    props: { input, context },
  };
}

/**
 * Read the plain-text output from a stored `ToolCallState.result`.
 * Returns `undefined` when nothing readable is present.
 *
 * The reducer's `handleToolResult` stores `event.output` (the literal
 * stdout string from the wire's `tool_result` event) directly into
 * `ToolCallState.result`, so the live shape is a bare `string`. We
 * also accept the wrapped `{ output: string }` shape for forward-
 * compat with future reducer changes that might preserve the full
 * `tool_result` payload, and for tests that historically constructed
 * the wrapped form. Anything else collapses to `undefined`.
 */
function extractTextOutput(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (result === null || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  return typeof r.output === "string" ? r.output : undefined;
}

/**
 * Tool-call dispatch — looks up the tool name in the registry, with
 * alias resolution, and surfaces a caution flag for unknown names
 * that aren't in the audit-confirmed default-routed list.
 *
 * Exported so the transcript view can route a `ToolCallState` (from
 * `TurnEntry.toolCalls` or the parsed `inflight.tools` snapshot) to a
 * `(Component, props)` pair without fabricating a full
 * `DispatchContext` — the tool-call branch never consumed it.
 */
export function dispatchToolCallState(
  toolCall: ToolCallState,
  msgId: string,
): DispatchResult {
  const lower = toolCall.toolName.toLowerCase();
  const canonical = TOOL_ALIASES.get(lower) ?? lower;
  const factory = TOOL_WRAPPER_REGISTRY.get(canonical);

  // Compose the props the wrapper expects (see ToolWrapperProps in
  // ./tool-wrappers/types.ts). Status maps the store's `pending |
  // done | error` to the wrapper's `streaming | ready | error`.
  const status =
    toolCall.status === "pending"
      ? "streaming"
      : toolCall.status === "error"
        ? "error"
        : "ready";

  const baseProps = {
    toolUseId: toolCall.toolUseId,
    toolName: toolCall.toolName,
    msgId,
    seq: 0, // populated by the transcript view from event ordering
    input: toolCall.input,
    structuredResult: toolCall.structuredResult,
    textOutput: extractTextOutput(toolCall.result),
    isError: toolCall.status === "error",
    status,
  };

  if (factory !== undefined) {
    // Registered wrapper — no caution.
    return { Component: factory, props: baseProps };
  }

  if (AUDIT_CONFIRMED_DEFAULT_TOOLS.has(canonical)) {
    // Known to route through Default by design — no caution.
    return { Component: DefaultToolWrapper, props: baseProps };
  }

  // Truly unknown — DefaultToolWrapper plus caution.
  const caution: CautionFlag = {
    reason: "unknown_tool",
    detail: toolCall.toolName,
  };
  return {
    Component: DefaultToolWrapper,
    props: { ...baseProps, caution },
    caution,
  };
}

// ---------------------------------------------------------------------------
// AssistantRendererDispatch interface — re-exposes the module surface
// as an object so consumers that prefer instance-style access (per
// Spec S01) can use it.
// ---------------------------------------------------------------------------

/**
 * Object-style facade over the module functions. Useful for tests and
 * for consumers that want to pass the dispatcher around as a single
 * value. The functions are also re-exported individually so
 * tree-shaking works naturally for consumers that only need one.
 */
export interface AssistantRendererDispatch {
  dispatch(input: RenderInput, context: DispatchContext): DispatchResult;
  resolveToolWrapper(toolName: string): ToolWrapperFactory;
  registeredTools(): ReadonlyArray<string>;
}

export const assistantRendererDispatch: AssistantRendererDispatch = {
  dispatch,
  resolveToolWrapper,
  registeredTools,
};

// ---------------------------------------------------------------------------
// Wrapper registrations — done here (not at the wrapper site) so the
// import graph flows in one direction: dispatch imports each wrapper,
// each wrapper imports types + chrome, no cycles. New wrappers add a
// line here as they ship.
// ---------------------------------------------------------------------------

registerToolWrapper("bash", BashToolBlock);
registerToolWrapper("read", ReadToolBlock);
registerToolWrapper("edit", EditToolBlock);
registerToolWrapper("glob", GlobToolBlock);
registerToolWrapper("grep", GrepToolBlock);
