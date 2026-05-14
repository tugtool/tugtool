/**
 * Shared types for the Tide assistant-rendering tool-wrapper layer.
 *
 * These contracts are consumed by:
 *   - `tide-assistant-renderer-dispatch.ts` — the registry + dispatch logic
 *   - every per-tool wrapper in `./tool-wrappers/*.tsx`
 *   - every body-kind primitive under `../body-kinds/*.tsx`
 *
 * Laws: [L19] component authoring guide — every wrapper that consumes
 *       `ToolWrapperProps` and renders a body owns its `data-slot`,
 *       its CSS file, and its slot tokens; this module defines the
 *       contract those wrappers conform to.
 *       [L20] component-token sovereignty — each consumer of these
 *       types owns its own scoped tokens; this types module declares
 *       no tokens.
 *
 * @module components/tugways/cards/tool-wrappers/types
 */

import type React from "react";

import type { PropertyStore } from "@/components/tugways/property-store";
import type { ToolCallState } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Caution flag — drift detection per drift-fallback decision.
// ---------------------------------------------------------------------------

/**
 * Surfaces a caution badge to the user when the dispatch encountered drift:
 * an unknown tool name, an unknown structured-result shape, or a version
 * mismatch against the pinned stream-json catalog. The caution badge is
 * rendered both inline at the offending event and as an aggregate count in
 * the card chrome.
 */
export interface CautionFlag {
  reason: "unknown_tool" | "unknown_shape" | "version_drift";
  detail?: string;
}

// ---------------------------------------------------------------------------
// Body-kind contract — every Layer-1 body-kind primitive conforms to this.
// ---------------------------------------------------------------------------

/**
 * Every body-kind primitive (`TerminalBlock`, `DiffBlock`, `FileBlock`, etc.)
 * accepts these props. `data` is the typed payload — each body kind narrows
 * `TData` to its own shape. `streamingStore` + `streamingPath` opt the body
 * into the streaming-binding contract: bodies that participate read the
 * store value synchronously on mount and observe for updates with rAF
 * coalescing; bodies that don't render once on completion and ignore both
 * fields.
 *
 * Collapse state is controlled — the body never owns its own boolean. The
 * host (typically a `ToolWrapperProps`-shaped wrapper) owns `collapsed`
 * and dispatches `onToggleCollapsed` when the user clicks the affordance.
 */
export interface BodyKindProps<TData = unknown> {
  /** The typed payload this body kind renders. */
  data: TData;
  /**
   * Optional `PropertyStore` for streaming-binding mode. When set, the body
   * subscribes to live updates per the streaming-binding contract; when
   * unset, it renders once from `data`.
   */
  streamingStore?: PropertyStore;
  /** PropertyStore path key for streaming mode. Default `"text"`. */
  streamingPath?: string;
  /**
   * Initial collapse state. Bodies that support collapse honor this; bodies
   * that don't support collapse ignore it.
   */
  collapsed?: boolean;
  /** Toggle callback. Called when the user activates the collapse affordance. */
  onToggleCollapsed?: (next: boolean) => void;
  /** Forwarded class name; cascade-scoped customization happens here. */
  className?: string;
  /**
   * Opt-in key for the Component State Preservation Protocol. When set,
   * the body kind persists its uncontrolled state (`collapsed`, inner
   * scroll position, view-toggle selection — whatever the body kind
   * carries) into `bag.components` and restores from there on mount.
   * Undefined opts out; gallery / standalone usage typically leaves
   * this unset. Body kinds that ignore the prop quietly drop it
   * (preservation is a feature, not a contract). See
   * `use-component-state-preservation.tsx`. [A9]
   */
  componentStatePreservationKey?: string;
}

// ---------------------------------------------------------------------------
// Tool-wrapper contract — every Layer-2 per-tool wrapper conforms to this.
// ---------------------------------------------------------------------------

/**
 * Wrapper-level lifecycle state. Distinguishes the placeholder phase (input
 * still streaming, no body to render yet), the steady-state render, and
 * the error state from `tool_result.is_error`.
 */
export type ToolWrapperStatus = "streaming" | "ready" | "error";

/**
 * Props passed to every per-tool wrapper. The wrapper composes a body kind
 * via `data` selection (each wrapper picks its own body) and adds chrome:
 * header (icon + tool name + args summary), footer (badges), and any
 * tool-specific interactions.
 *
 * `input` may arrive partial during streaming — the wrapper must handle
 * `undefined` and partial-shape values by showing the streaming placeholder
 * until the input completes (or `tool_use_structured` arrives).
 */
export interface ToolWrapperProps<TInput = unknown, TStructured = unknown> {
  /** Stable identifier joining tool_use ↔ tool_result. */
  toolUseId: string;
  /** Canonical tool name as emitted on the wire (case may vary). */
  toolName: string;
  /** Owning turn's message id; used to scope streaming subscriptions. */
  msgId: string;
  /** Owning turn's sequence number; used for ordering across concurrent calls. */
  seq: number;
  /** Tool input as it arrives. May be empty / partial during streaming. */
  input?: TInput;
  /** Plain-text output from `tool_result.output`. */
  textOutput?: string;
  /** Typed output from `tool_use_structured.structured_result`, when present. */
  structuredResult?: TStructured;
  /** True when `tool_result.is_error === true`. */
  isError?: boolean;
  /** Wall-clock duration; usually computed by the wrapper from start/end timestamps. */
  durationMs?: number;
  /** Lifecycle state per the streaming → ready → error progression. */
  status: ToolWrapperStatus;
  /** Drift caution; rendered as an inline chip on the wrapper chrome. */
  caution?: CautionFlag;
  /**
   * Recursion depth — `0` for a top-level tool call, incremented by
   * one each time a wrapper dispatches a *nested* tool call (today
   * only `TaskToolBlock` → `AgentTranscriptBlock` does this, per
   * [D17]). Wrappers that never recurse ignore it; `TaskToolBlock`
   * reads it to drive the `AgentTranscriptBlock` depth-cap collapse.
   * Threaded by `dispatchToolCallState`'s optional `depth` argument.
   */
  depth?: number;
}

/**
 * A tool-wrapper React component. Each entry in the dispatch registry maps
 * a lowercased tool name to one of these. Wrappers are React components,
 * not classes — `React.ComponentType` lets the dispatch hand the same
 * reference back to consumers that mount with JSX.
 */
export type ToolWrapperFactory = React.ComponentType<ToolWrapperProps>;

// ---------------------------------------------------------------------------
// `tool_call` view — the dispatch's normalized form of a `ToolCallState` for
// the tool-call kind of `RenderInput`. Re-exported here so the dispatch and
// any wrapper-side code can read the same shape.
// ---------------------------------------------------------------------------

export type { ToolCallState };
