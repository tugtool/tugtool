/**
 * `tide-card-phase-indicator` — the Z4 prompt-entry-footer phase
 * indicator: its pure projection and the component that renders it.
 *
 * Z4 of the tide-card lifecycle matrix is a short status line in the
 * prompt-entry toolbar — it tells the user, right where
 * they type, what the in-flight turn is doing. The matrix gives Z4
 * content in exactly three lifecycle states —
 *
 *   - AWAITING_FIRST_TOKEN → "Awaiting first token"
 *   - STREAMING            → "Claude is thinking"
 *   - TOOL_WORK            → "Running {tool_name}"
 *
 * — and leaves it empty everywhere else (the matrix's "(default)" Z4
 * cell). The matrix's overlay rows (TRANSPORT_DOWN / QUEUED_NEXT_TURN)
 * do not touch Z4, so the projection is a function of the base
 * `TideLifecycleState` alone.
 *
 * The module pairs a pure projection — `resolvePhaseIndicatorView` and
 * `currentToolNameFromCalls`, unit-tested in isolation — with the
 * `TidePhaseIndicator` component that wraps the store subscriptions.
 * Both halves live in one file the way `tide-card-telemetry-renderers`
 * co-locates its pure formatters with its renderers; the pure
 * functions import nothing from React and a test reaches them without
 * a render.
 *
 * Conformance:
 *   - [L02] — lifecycle state enters through `useLifecycleState()`;
 *     the streaming tool list through `useSyncExternalStore`. No
 *     React-state mirror of either; the pure projection never sees
 *     `phase`, only the projected `TideLifecycleState`.
 *   - [L06] — the live lifecycle state is published as a `data-state`
 *     attribute so CSS owns any per-state visual; the component sets
 *     no appearance in React.
 *   - [L23] / [L26] — the indicator mounts in the prompt-entry's
 *     always-present footer-content slot; content swaps inside that
 *     stable container (a `<span>` ↔ nothing) with no remount.
 *
 * @module components/tugways/cards/tide-card-phase-indicator
 */

import "./tide-card-phase-indicator.css";

import React, { useCallback, useSyncExternalStore } from "react";

import type { CodeSessionStore, ToolCallState } from "@/lib/code-session-store";
import type { TideLifecycleState } from "@/lib/code-session-store/lifecycle-state";
import { useLifecycleState } from "@/lib/code-session-store/hooks/use-lifecycle-state";

// ---------------------------------------------------------------------------
// Pure projection (exported for tests)
// ---------------------------------------------------------------------------

/**
 * The Z4 phase-indicator view. `text: null` is the matrix's empty Z4
 * cell — the component renders nothing and the footer slot collapses
 * to a transparent flex spacer.
 */
export interface PhaseIndicatorView {
  text: string | null;
}

/**
 * Pick the tool name the TOOL_WORK indicator interpolates: the most
 * recently-started call still `pending` (no `tool_result` yet). Claude
 * can run tools in parallel; the last pending entry is the freshest
 * "currently running" signal, and the matrix's Z4 line is singular.
 * Returns `null` when nothing is pending — a `tool_work` phase whose
 * calls have all resolved between the `tool_use` and the next
 * agent-loop step — and the caller falls back to a generic label.
 */
export function currentToolNameFromCalls(
  toolCalls: ReadonlyArray<ToolCallState>,
): string | null {
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const call = toolCalls[i];
    if (call.status === "pending") return call.toolName;
  }
  return null;
}

/**
 * Project a lifecycle state onto the Z4 prompt-entry-footer indicator.
 *
 * `toolName` is consulted only for TOOL_WORK; pass the
 * `currentToolNameFromCalls` result (or `null` when no turn is in
 * flight). A `tool_work` state with no resolvable tool name falls back
 * to the generic "Running a tool" rather than rendering nothing — the
 * phase itself is the signal, the name is the embellishment.
 */
export function resolvePhaseIndicatorView(
  state: TideLifecycleState,
  toolName: string | null,
): PhaseIndicatorView {
  switch (state) {
    case "awaiting_first_token":
      return { text: "Awaiting first token" };
    case "streaming":
      return { text: "Claude is thinking" };
    case "tool_work":
      return {
        text: toolName !== null ? `Running ${toolName}` : "Running a tool",
      };
    case "idle":
    case "submitting":
    case "awaiting_user":
    case "interrupting":
    case "replaying":
    case "errored":
    case "complete":
      return { text: null };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Reused for every empty-list parse so the fall-through stays cheap. */
const EMPTY_TOOL_CALLS: ReadonlyArray<ToolCallState> = Object.freeze([]);

/**
 * Subscribe to the in-flight turn's tool list and return the name of
 * the tool currently running, or `null` when no turn is in flight or
 * nothing is pending.
 *
 * The streaming tool calls land on the streaming document at the
 * per-turn path `turn.${turnKey}.tools`; the `turnKey` comes off
 * `inflightUserMessage`. Two `useSyncExternalStore` boundaries
 * compose: one on the code-session store for the live `turnKey`, one
 * on the streaming document for the tool list at the resolved path.
 *
 * `getSnapshot` returns a `string | null` — a primitive — so it is
 * value-stable across calls with unchanged store data without the
 * serialized-identity cache an array-returning snapshot would need.
 */
function useCurrentToolName(store: CodeSessionStore): string | null {
  const turnKey = useSyncExternalStore(
    store.subscribe,
    useCallback(
      () => store.getSnapshot().inflightUserMessage?.turnKey ?? null,
      [store],
    ),
  );
  const streamingStore = store.streamingDocument;
  const path = turnKey !== null ? `turn.${turnKey}.tools` : null;

  const subscribe = useCallback(
    (listener: () => void) =>
      path !== null ? streamingStore.observe(path, listener) : () => {},
    [streamingStore, path],
  );
  const getSnapshot = useCallback((): string | null => {
    if (path === null) return null;
    const raw = streamingStore.get(path);
    if (typeof raw !== "string") return null;
    let parsed: ReadonlyArray<ToolCallState>;
    try {
      const candidate = JSON.parse(raw) as unknown;
      parsed = Array.isArray(candidate)
        ? (candidate as ReadonlyArray<ToolCallState>)
        : EMPTY_TOOL_CALLS;
    } catch {
      // The producer is the reducer's `serializeToolCalls`, which only
      // emits valid arrays; this branch is forward-compat defense.
      parsed = EMPTY_TOOL_CALLS;
    }
    return currentToolNameFromCalls(parsed);
  }, [streamingStore, path]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export interface TidePhaseIndicatorProps {
  codeSessionStore: CodeSessionStore;
}

/**
 * The Z4 phase indicator. Renders the matrix's Z4 line for the three
 * in-flight states that carry one and `null` for every other state —
 * the footer-content slot collapses to a transparent flex spacer in
 * that case, which is the matrix's "(default)" Z4 cell.
 */
export const TidePhaseIndicator: React.FC<TidePhaseIndicatorProps> = ({
  codeSessionStore,
}) => {
  const lifecycle = useLifecycleState(codeSessionStore);
  const toolName = useCurrentToolName(codeSessionStore);
  const view = resolvePhaseIndicatorView(lifecycle.state, toolName);
  if (view.text === null) return null;
  return (
    <span
      className="tide-phase-indicator"
      data-slot="tide-phase-indicator"
      data-state={lifecycle.state}
    >
      {view.text}
    </span>
  );
};
