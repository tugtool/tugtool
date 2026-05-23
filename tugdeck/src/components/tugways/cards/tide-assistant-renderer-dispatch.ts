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
 *   `tool_call`, to `DefaultToolBlock` with a caution reason.
 * - `resolveToolBlock(name)` looks up by lowercased tool name with
 *   alias resolution. Returns `DefaultToolBlock` for misses.
 * - `registeredTools()` enumerates the canonical names of every
 *   wrapper in the registry (excluding aliases and the default
 *   fallback). Test-facing.
 *
 * # Registry & aliases
 *
 * The registry is a module-static `Map<string, ToolBlockFactory>`
 * keyed on lowercased canonical names. The alias map handles
 * historical renames (most importantly `task → agent`, since real
 * Claude Code now emits `Agent` rather than the historical `Task` —
 * see the empirical session audit) and synonyms (`multiedit → edit`).
 *
 * # Drift detection (caution flags)
 *
 * Three drift signals are detected and surfaced as a `caution` —
 * inline at the offending event (the tool-block chrome paints a
 * `TideCautionBadge` from the threaded `caution` prop) and, in
 * aggregate, on the card chrome (`TideRouteIndicatorBadge` counts
 * `summarizeDrift`'s events):
 *
 *  - `unknown_tool` — a `tool_call` whose name is not in the registry
 *    and not an audit-confirmed default route.
 *  - `unknown_shape` — a registered wrapper whose present
 *    `structured_result` fails its shallow top-level shape schema
 *    (`STRUCTURED_RESULT_SCHEMAS` / `checkStructuredShape`). The call
 *    falls back to `DefaultToolBlock` — `JsonTreeBlock` over the raw
 *    payload — per [D04].
 *  - `version_drift` — a `system_metadata` event whose `version`
 *    is on a different `major.minor` line than `VALIDATED_CC_VERSION`
 *    (a patch difference within the validated line is not drift —
 *    see `versionLine`).
 *
 * `detectToolCallDrift` and `detectVersionDrift` are the per-event
 * detectors; `summarizeDrift` walks a whole transcript with them to
 * produce the card-chrome aggregate. Every distinct drift event is
 * logged once via `logDriftEvent` for triage.
 *
 * The unknown-tool flag is suppressed when the name resolves through
 * an alias OR when the name is in the audit-confirmed default-routed
 * list (see `AUDIT_CONFIRMED_DEFAULT_TOOLS`) — those tools are *known*
 * to route through `DefaultToolBlock` by design rather than because
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

import { BashToolBlock } from "./tool-blocks/bash-tool-block";
import { ReadToolBlock } from "./tool-blocks/read-tool-block";
import { EditToolBlock } from "./tool-blocks/edit-tool-block";
import { GlobToolBlock } from "./tool-blocks/glob-tool-block";
import { GrepToolBlock } from "./tool-blocks/grep-tool-block";
import { TaskToolBlock } from "./tool-blocks/task-tool-block";
import { AskUserQuestionToolBlock } from "./tool-blocks/ask-user-question-tool-block";
import { DefaultToolBlock } from "./tool-blocks/default-tool-block";
import { PermissionDialog } from "@/components/tugways/chrome/tide-permission-dialog";
import { QuestionDialog } from "@/components/tugways/chrome/tide-question-dialog";
import type {
  CautionFlag,
  ChildToolCallsMap,
  ToolBlockFactory,
} from "./tool-blocks/types";

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
      /**
       * Set when this is a *committed* permission record being
       * re-rendered as a permanent transcript artifact ([D13]) — the
       * decision the user already made. Omitted for a live pending
       * request (the dialog reads the live store instead).
       */
      resolvedDecision?: "allow" | "deny";
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
// Tool-block registry and aliases.
// ---------------------------------------------------------------------------

/**
 * Module-static registry. Keys are lowercased canonical tool names.
 * Real per-tool blocks register themselves via `registerToolBlock`
 * as they ship (BashToolBlock at #step-6, ReadToolBlock at #step-8,
 * EditToolBlock at #step-11 — `multiedit` aliases to it — etc.). Until
 * they ship, the registry contains only the audit-confirmed routes —
 * every `tool_call` not in the registry lands on `DefaultToolBlock`
 * with a caution flag.
 */
const TOOL_BLOCK_REGISTRY = new Map<string, ToolBlockFactory>();

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
 * Audit-confirmed tool names that route through `DefaultToolBlock`
 * by design. These suppress the `unknown_tool` caution because they
 * are *known* tools whose JsonTree-based default rendering is
 * sufficient — they appeared in the empirical session audit and were
 * scoped to Default rather than getting bespoke wrappers.
 *
 * Promote an entry from here to `TOOL_BLOCK_REGISTRY` later if
 * dogfooding shows the default rendering is suboptimal.
 *
 * **Per [D100]: `TaskCreate` and `TaskUpdate` are NOT in this set.**
 * The Step 24.1 spike confirmed they are the new todo system (the
 * replacement for the retired `TodoWrite` tool, ≥ `claude v2.1.148`),
 * not background-task management. Both render as a `NullToolBlock`
 * in `TOOL_BLOCK_REGISTRY` so the transcript carries zero per-call
 * entries; the assembled list lives in the pinned `Z2A` slot, which
 * is the sole surface. `TaskList` / `TaskGet` / `TaskOutput` /
 * `TaskStop` remain default-routed: they are very rare in practice
 * (the audit volumes are 0.05% / unknown / 0.06% / 0.01%) and a
 * generic structured-result row is sufficient. `TaskGet` was
 * missing from the original audit set; included defensively now to
 * avoid an `unknown_tool` caution if the assistant ever calls it.
 */
const AUDIT_CONFIRMED_DEFAULT_TOOLS: ReadonlySet<string> = new Set([
  // Task* tools that stay default-routed — the rare ones, not the
  // load-bearing TaskCreate / TaskUpdate pair (silenced via the
  // registry; see below).
  "tasklist",
  "taskget",
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
 * Silent renderer used by `TaskCreate` / `TaskUpdate` per [D100]: the
 * pinned `Z2A` slot is the sole surface for the task list, so the
 * per-call events do not paint into the transcript. Returning `null`
 * leaves no DOM child for the row — `tide-card-transcript-tool-calls`
 * iterates and renders each tool block, and a null return adds zero
 * markup. The container itself (`.tide-transcript-tool-calls`) stays
 * present in the assistant turn, so a turn whose only tool calls
 * are Task* events shows the prose / thinking content with no
 * tool-call rows underneath.
 *
 * Registering here (rather than adding the names to
 * `AUDIT_CONFIRMED_DEFAULT_TOOLS`) is what produces the silence: the
 * audit set falls through to `DefaultToolBlock`, which paints a row;
 * the registry's null factory paints nothing.
 */
const NullToolBlock: ToolBlockFactory = () => null;

/**
 * Register a tool block. Called by tool-block modules at import
 * time as they ship. The name is lowercased before insertion so the
 * registry key vocabulary is uniform.
 *
 * Idempotent: re-registering the same name overwrites the existing
 * entry, which is the right behavior for HMR and for tests that need
 * to swap a wrapper out.
 */
export function registerToolBlock(
  name: string,
  factory: ToolBlockFactory,
): void {
  TOOL_BLOCK_REGISTRY.set(name.toLowerCase(), factory);
}

/**
 * Test-only: clear the registry. Used by the dispatch test to start
 * each test from a known empty state. Production code never calls
 * this.
 */
export function _resetToolBlockRegistryForTests(): void {
  TOOL_BLOCK_REGISTRY.clear();
}

/**
 * Resolve a tool block by name. Case-insensitive. Aliases are
 * resolved before lookup. Returns `DefaultToolBlock` for misses —
 * never returns `undefined`.
 */
export function resolveToolBlock(toolName: string): ToolBlockFactory {
  const lower = toolName.toLowerCase();
  const canonical = TOOL_ALIASES.get(lower) ?? lower;
  return TOOL_BLOCK_REGISTRY.get(canonical) ?? DefaultToolBlock;
}

/**
 * Enumerate the canonical names of every registered wrapper. Aliases
 * and `DefaultToolBlock` are NOT included — only the wrappers that
 * are explicitly registered. The test suite uses this to verify the
 * registry's coverage matches Table T02 at phase exit.
 */
export function registeredTools(): ReadonlyArray<string> {
  return Array.from(TOOL_BLOCK_REGISTRY.keys()).sort();
}

// ---------------------------------------------------------------------------
// Drift detection — validated catalog version, structured-result
// schemas, per-event detectors, the transcript-wide aggregate, and
// triage logging.
// ---------------------------------------------------------------------------

/**
 * The Claude Code stream-json version the Tide renderers were last
 * validated against — the most recent `just capture-capabilities`
 * baseline. `TideRouteIndicatorBadge` displays it as the "validated against"
 * reference, and `versionDriftCaution` compares its `major.minor`
 * line against the running session's.
 *
 * Build-time constant. Bump it whenever a fresh capture advances the
 * golden catalog. Note that `version_drift` keys on the `major.minor`
 * *line* (see `versionLine`), so a stale patch number here is
 * harmless for drift detection — it only shows as a slightly old
 * "validated against" figure until the next capture. `system_metadata`
 * emits the bare version (`"2.1.147"`), so the constant carries no
 * `v` prefix. This is the render-time complement to
 * `tide.md#p15-stream-json-version-gate`'s server-side telemetry.
 */
export const VALIDATED_CC_VERSION = "2.1.147";

/**
 * Expected runtime type for a required top-level field in a tool's
 * `structured_result`. `"array"` is checked via `Array.isArray`; the
 * rest map onto `typeof`. `"object"` excludes arrays and `null`.
 */
export type StructuredFieldType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

/**
 * A tool's structured-result shape contract — the load-bearing
 * top-level fields a bespoke wrapper needs present and correctly
 * typed to render its rich body. Shallow by decision ([D04]): only
 * top-level field presence + type, never deep validation. A tool
 * whose every structured field is optional (Bash / Edit / Glob /
 * Grep / Agent all narrow defensively and degrade gracefully) has no
 * entry — there is no shape it can meaningfully *fail*.
 */
export type StructuredResultSchema = Readonly<
  Record<string, StructuredFieldType>
>;

/**
 * Per-tool structured-result schemas, keyed by canonical (lowercased)
 * tool name. Only `read` has a load-bearing required field: its
 * `FileBlock` body needs `structured_result.file` to be an object
 * (the file payload). `file.content` is deliberately NOT required —
 * an image Read legitimately omits it (`type` distinguishes), so
 * requiring it would false-positive once image reads ship. The check
 * stays at the top level per [D04]'s "field presence and types at
 * top level, not deep validation."
 */
const STRUCTURED_RESULT_SCHEMAS: ReadonlyMap<string, StructuredResultSchema> =
  new Map([["read", { file: "object" }]]);

/**
 * Shallow shape check ([D04]). Returns a human-readable mismatch
 * detail when `value` (a present `structured_result`) fails `schema`
 * — a missing required field, or one of the wrong type — and `null`
 * when every required field is present and correctly typed.
 *
 * Only the top-level fields named in `schema` are inspected; extra
 * fields and nested shapes are not validated. Callers gate on the
 * `structured_result` being a present object before calling — an
 * absent / `null` result is the streaming or no-structured-event
 * case the wrapper handles with its placeholder, not drift.
 */
export function checkStructuredShape(
  value: Record<string, unknown>,
  schema: StructuredResultSchema,
): string | null {
  for (const [field, expected] of Object.entries(schema)) {
    const actual = value[field];
    if (actual === undefined) {
      return `${field}: missing`;
    }
    const ok =
      expected === "array"
        ? Array.isArray(actual)
        : expected === "object"
          ? actual !== null &&
            typeof actual === "object" &&
            !Array.isArray(actual)
          : typeof actual === expected;
    if (!ok) {
      const got = Array.isArray(actual)
        ? "array"
        : actual === null
          ? "null"
          : typeof actual;
      return `${field}: expected ${expected}, got ${got}`;
    }
  }
  return null;
}

/**
 * Pull `system_metadata.version` from a metadata payload. Returns the
 * version string, or `null` when the payload is not an object or
 * carries no string `version`.
 */
export function extractMetadataVersion(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const version = (metadata as Record<string, unknown>).version;
  return typeof version === "string" ? version : null;
}

/**
 * The `major.minor` line of a version string — `"2.1.148"` → `"2.1"`.
 * A version with fewer than two dotted segments is returned whole.
 * Drift compares lines, not patches: Anthropic ships Claude Code patch
 * releases almost daily and they essentially never change stream-json
 * shapes, whereas a minor bump is where event shapes have historically
 * diverged. Comparing lines keeps the badge quiet through normal daily
 * churn and loud only at the rare, meaningful boundary.
 */
export function versionLine(version: string): string {
  const parts = version.split(".");
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : version;
}

/**
 * `version_drift` detector over a bare version string — compares its
 * `major.minor` line against `VALIDATED_CC_VERSION`'s. Returns a
 * `CautionFlag` when the lines differ, `null` when they match (any
 * patch difference within the validated line included) or `version`
 * is `null` (a session with no captured version yet).
 */
export function versionDriftCaution(version: string | null): CautionFlag | null {
  if (version === null) return null;
  if (versionLine(version) === versionLine(VALIDATED_CC_VERSION)) return null;
  return {
    reason: "version_drift",
    detail: `${version} ≠ ${VALIDATED_CC_VERSION}`,
  };
}

/**
 * `version_drift` detector over a raw `system_metadata` payload —
 * extracts `version` and defers to `versionDriftCaution`. Consumed by
 * the `dispatch` `system_metadata` branch.
 */
export function detectVersionDrift(metadata: unknown): CautionFlag | null {
  return versionDriftCaution(extractMetadataVersion(metadata));
}

/**
 * Per-tool-call drift detector — the single source of truth for
 * tool-call drift. Returns a `CautionFlag` when the call is drifted,
 * `null` otherwise. Pure over the static registry.
 *
 *  - `unknown_tool` — the name resolves to no registered wrapper and
 *    is not an audit-confirmed default route.
 *  - `unknown_shape` — a registered (or audit-confirmed) tool with a
 *    shape schema whose present `structured_result` fails the shallow
 *    top-level check. Skipped for errored calls (an error result
 *    legitimately carries no / a divergent structured payload) and
 *    for absent results (streaming — the wrapper's placeholder owns
 *    that window, not drift).
 *
 * Consumed both by `dispatchToolCallState` (which routes a drifted
 * call to `DefaultToolBlock`) and by `summarizeDrift` (the
 * card-chrome aggregate counter).
 */
export function detectToolCallDrift(
  toolCall: ToolCallState,
): CautionFlag | null {
  const lower = toolCall.toolName.toLowerCase();
  const canonical = TOOL_ALIASES.get(lower) ?? lower;

  if (
    !TOOL_BLOCK_REGISTRY.has(canonical) &&
    !AUDIT_CONFIRMED_DEFAULT_TOOLS.has(canonical)
  ) {
    return { reason: "unknown_tool", detail: toolCall.toolName };
  }

  if (toolCall.status !== "error") {
    const schema = STRUCTURED_RESULT_SCHEMAS.get(canonical);
    const result = toolCall.structuredResult;
    if (schema !== undefined && result !== null && typeof result === "object") {
      const mismatch = checkStructuredShape(
        result as Record<string, unknown>,
        schema,
      );
      if (mismatch !== null) {
        return {
          reason: "unknown_shape",
          detail: `${toolCall.toolName}: ${mismatch}`,
        };
      }
    }
  }
  return null;
}

/**
 * A single drift occurrence — the unit `logDriftEvent` logs for
 * triage and `TideDriftCaution` lists in its click-expand popover.
 */
export interface DriftEvent {
  /** The drift caution — reason + human-readable detail. */
  caution: CautionFlag;
  /** Offending tool name, when the drift is a tool call. */
  toolName?: string;
  /** Offending `tool_use` id — stable per occurrence — for tool drift. */
  toolUseId?: string;
  /** Drifted runtime version, when the drift is `version_drift`. */
  version?: string;
}

/**
 * The transcript-wide drift aggregate — `count` is the card-chrome
 * "drift detected: N events" figure; `events` backs the click-expand
 * list.
 */
export interface DriftSummary {
  count: number;
  events: ReadonlyArray<DriftEvent>;
}

/**
 * Walk a session's tool calls plus its runtime version and collect
 * every drift event — the aggregate the card-chrome caution chip
 * (`TideDriftCaution`) surfaces. Pure over the static registry.
 *
 * `toolCalls` is the flat per-session tool-call list (every committed
 * turn's `toolCalls` concatenated, in transcript order); `version` is
 * the live `system_metadata.version` (`null` before the metadata
 * event lands). Version drift, when present, is appended last.
 */
export function summarizeDrift(args: {
  toolCalls: ReadonlyArray<ToolCallState>;
  version: string | null;
}): DriftSummary {
  const events: DriftEvent[] = [];
  for (const toolCall of args.toolCalls) {
    const caution = detectToolCallDrift(toolCall);
    if (caution !== null) {
      events.push({
        caution,
        toolName: toolCall.toolName,
        toolUseId: toolCall.toolUseId,
      });
    }
  }
  const versionCaution = versionDriftCaution(args.version);
  if (versionCaution !== null) {
    events.push({
      caution: versionCaution,
      version: args.version ?? undefined,
    });
  }
  return { count: events.length, events };
}

/**
 * Drift keys already logged this session. Dedupes the console-log so
 * a drift event is reported once for triage rather than on every
 * re-render that re-detects it (drift detection is pure and re-runs
 * freely). Drift is rare, so this set stays small.
 */
const loggedDriftKeys = new Set<string>();

/**
 * Test-only: clear the drift-log dedup set so each test starts from a
 * known state. Production code never calls this.
 */
export function _resetDriftLogForTests(): void {
  loggedDriftKeys.clear();
}

/** Stable per-occurrence dedup key for a drift event. */
function driftLogKey(event: DriftEvent): string {
  if (event.caution.reason === "version_drift") {
    return `version:${event.version ?? event.caution.detail ?? ""}`;
  }
  return `${event.toolUseId ?? ""}:${event.caution.reason}`;
}

/**
 * Log a drift event to the console for triage — once per distinct
 * occurrence. Emits `console.warn` with the reason, tool name,
 * version, and the caution-detail summary: the breadcrumb a user
 * needs to report a stream-json shape divergence. Re-calling with an
 * already-logged event is a no-op.
 */
export function logDriftEvent(event: DriftEvent): void {
  const key = driftLogKey(event);
  if (loggedDriftKeys.has(key)) return;
  loggedDriftKeys.add(key);
  console.warn("[tide drift] stream-json drift detected", {
    reason: event.caution.reason,
    toolName: event.toolName,
    version: event.version,
    summary: event.caution.detail,
  });
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
//   permission     → PermissionDialog (real renderer; #step-18)
//   question       → QuestionDialog (real renderer; #step-20-5-b)
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
 * goes through `resolveToolBlock` — every tool routes through
 * either a registered wrapper or `DefaultToolBlock`, so there's no
 * meaningful kind-level scaffold for it.
 */
export const KIND_RENDERERS: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [K in Exclude<RenderInputKind, "tool_call">]: React.ComponentType<any>;
} = {
  assistant_text: makeScaffoldRenderer("assistant_text"),
  thinking: makeScaffoldRenderer("thinking"),
  user_text: makeScaffoldRenderer("user_text"),
  permission: PermissionDialog,
  question: QuestionDialog,
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
  if (input.kind === "system_metadata") {
    // Version-drift check ([D04]): a `system_metadata.version` that
    // diverges from the pinned catalog raises a `version_drift`
    // caution, threaded onto the props so a real `system_metadata`
    // renderer (the #step-29 SessionInitBanner) can paint the inline
    // marker, and returned on the result so the card-chrome aggregate
    // counts it.
    const caution = detectVersionDrift(input.metadata) ?? undefined;
    return {
      Component: KIND_RENDERERS.system_metadata,
      props: { input, context, caution },
      caution,
    };
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
 * alias resolution. A call that `detectToolCallDrift` flags (unknown
 * tool name, or a registered wrapper whose `structured_result` fails
 * its shallow shape schema) routes to `DefaultToolBlock` with the
 * caution threaded onto the props and returned on the result.
 *
 * Exported so the transcript view can route a `ToolCallState` (from
 * `TurnEntry.toolCalls` or the parsed `inflight.tools` snapshot) to a
 * `(Component, props)` pair without fabricating a full
 * `DispatchContext` — the tool-call branch never consumed it.
 *
 * `depth` (default `0`) is the [D17] recursion depth: `AgentTranscriptBlock`
 * passes `depth + 1` when it routes a *nested* tool call, so a nested
 * `Agent` (→ `TaskToolBlock` → `AgentTranscriptBlock`) knows how deep it
 * is and can collapse past the depth cap. Top-level callers omit it.
 *
 * `childToolCallsByParent` ([#step-17-5]) is the subagent-nesting map —
 * the transcript view builds it once from the flat tool-call list and
 * threads it through here so `TaskToolBlock` can resolve a subagent's
 * child tool calls. Top-level callers that have no subagents omit it.
 */
export function dispatchToolCallState(
  toolCall: ToolCallState,
  msgId: string,
  depth = 0,
  childToolCallsByParent?: ChildToolCallsMap,
  session?: CodeSessionStore,
): DispatchResult {
  const lower = toolCall.toolName.toLowerCase();
  const canonical = TOOL_ALIASES.get(lower) ?? lower;
  const factory = TOOL_BLOCK_REGISTRY.get(canonical);

  // Compose the props the wrapper expects (see ToolBlockProps in
  // ./tool-blocks/types.ts). Status maps the store's `pending |
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
    depth,
    childToolCallsByParent,
    session,
  };

  const caution = detectToolCallDrift(toolCall);
  if (caution !== null) {
    // Drift — an unknown tool name, or a registered wrapper whose
    // `structured_result` failed its shallow shape schema. Either way
    // the [D04] fallback is `DefaultToolBlock` (`JsonTreeBlock` over
    // the raw payload); the caution is threaded onto the props so the
    // wrapper chrome paints the inline `TideCautionBadge`, and
    // returned on the result so the card-chrome aggregate counts it.
    return {
      Component: DefaultToolBlock,
      props: { ...baseProps, caution },
      caution,
    };
  }

  if (factory !== undefined) {
    // Registered wrapper, shape intact — route to the bespoke wrapper.
    return { Component: factory, props: baseProps };
  }

  // Audit-confirmed long-tail tool — known to route through
  // `DefaultToolBlock` by design, so no caution.
  return { Component: DefaultToolBlock, props: baseProps };
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
  resolveToolBlock(toolName: string): ToolBlockFactory;
  registeredTools(): ReadonlyArray<string>;
}

export const assistantRendererDispatch: AssistantRendererDispatch = {
  dispatch,
  resolveToolBlock,
  registeredTools,
};

// ---------------------------------------------------------------------------
// Wrapper registrations — done here (not at the wrapper site) so the
// import graph flows in one direction: dispatch imports each wrapper,
// each wrapper imports types + chrome, no cycles. New wrappers add a
// line here as they ship.
// ---------------------------------------------------------------------------

registerToolBlock("bash", BashToolBlock);
registerToolBlock("read", ReadToolBlock);
registerToolBlock("edit", EditToolBlock);
registerToolBlock("glob", GlobToolBlock);
registerToolBlock("grep", GrepToolBlock);
// Canonical `agent`; the historical `task` name resolves here via the
// `task → agent` alias in `TOOL_ALIASES`. ([D16])
registerToolBlock("agent", TaskToolBlock);
// Per [D100]: TaskCreate / TaskUpdate are the v2.1.148+ replacement
// for the retired TodoWrite tool, and the pinned `Z2A` slot is the
// sole surface for the assembled task list. Register a null factory
// so per-call events do not paint into the transcript.
registerToolBlock("taskcreate", NullToolBlock);
registerToolBlock("taskupdate", NullToolBlock);
// AskUserQuestion's *live* surface is the inline `QuestionDialog`
// ([D13]); this wrapper renders the durable Q&A artifact that
// remains in the turn after the dialog clears.
registerToolBlock("askuserquestion", AskUserQuestionToolBlock);
