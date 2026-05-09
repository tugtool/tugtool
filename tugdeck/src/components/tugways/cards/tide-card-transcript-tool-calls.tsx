/**
 * `TranscriptToolCalls` — renders a turn's tool calls inside the
 * `code` row body.
 *
 * Built in [#step-6-5] to close the wire-through gap that left every
 * Layer-2 tool wrapper invisible in the live UI: Steps 1-6 produced
 * the dispatch + the BashToolBlock wrapper, but
 * `tide-card-transcript.tsx` never iterated `turn.toolCalls`. This
 * component is the single iteration point for both the committed and
 * the in-flight (streaming) paths, so every wrapper that registers in
 * the dispatch (#step-1, #step-6, #step-8 onward) becomes
 * live-visible without further plumbing.
 *
 * Two modes, mutually exclusive at the type level:
 *
 *   1. **Static** — `<TranscriptToolCalls toolCalls={turn.toolCalls}
 *      msgId={turn.msgId} />`. Maps each `ToolCallState` through the
 *      dispatch and renders the resolved Component with the composed
 *      props. Used by the committed row.
 *
 *   2. **Streaming** — `<TranscriptToolCalls streamingStore={…}
 *      streamingPath="inflight.tools" msgId={…} />`. Subscribes to
 *      the `PropertyStore` path that the reducer keeps in sync with
 *      the in-flight `toolCallMap`; on each emission, re-parses the
 *      JSON to a `ToolCallState[]` and routes each entry through the
 *      dispatch. Used by the streaming row.
 *
 * Both modes route through `dispatchToolCallState`; both key the
 * rendered wrappers by `toolUseId` so a tool whose status transitions
 * `pending → done` reconciles in place rather than remounting.
 *
 * Render order in the row body is `thinking → tool calls → assistant`
 * (the [#step-6-5] decision). The container itself paints no
 * chrome — wrappers own their margins/borders. We render a flex
 * column with a single per-call gap composed from `--tug-space-*`,
 * and we render *nothing* when the list is empty so an empty
 * container doesn't show up in the DOM for tool-free turns.
 *
 * Laws:
 *  - [L02] streaming mode subscribes via `useSyncExternalStore`. The
 *    snapshot getter caches the parsed array by serialized-JSON
 *    identity so repeated calls return the same `Object.is`-stable
 *    reference for unchanged values, satisfying React's tearing
 *    contract.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tide-transcript-tool-calls"` on the container.
 *
 * Decisions:
 *  - [D05] each tool call is a Layer-2 wrapper resolved from the
 *    dispatch registry — this component is the iteration scaffold,
 *    not a renderer in its own right.
 *  - [D11] unregistered tool names route through `DefaultToolWrapper`
 *    with a caution flag, surfaced inline by the wrapper chrome.
 *  - [D12] streaming-aware wrappers (BashToolBlock today) decide for
 *    themselves how to render their `status === "streaming"` body
 *    (placeholder vs. partial content); this component just keeps
 *    the prop bag flowing.
 *
 * Importing this module from `tide-card-transcript.tsx` is also what
 * causes the dispatch's bottom-of-file `registerToolWrapper(...)`
 * calls to evaluate at module-load time in production. Today the
 * dispatch is only reachable from tests + the wrapper itself, so the
 * registrations never run in the live bundle.
 *
 * @module components/tugways/cards/tide-card-transcript-tool-calls
 */

import "./tide-card-transcript-tool-calls.css";

import React, { useCallback, useRef, useSyncExternalStore } from "react";

import type { PropertyStore } from "@/components/tugways/property-store";
import type { ToolCallState } from "@/lib/code-session-store";

import { dispatchToolCallState } from "./tide-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface StaticProps {
  toolCalls: ReadonlyArray<ToolCallState>;
  msgId: string;
  className?: string;
}

interface StreamingProps {
  /**
   * The `PropertyStore` that holds the in-flight tool-call list at
   * `streamingPath`. Today the only wired source is
   * `codeSessionStore.streamingDocument` and the path is
   * `streamingPaths.tools` (the literal `"inflight.tools"`).
   */
  streamingStore: PropertyStore;
  streamingPath: string;
  /**
   * The in-flight `msg_id` the tool calls belong to. Threaded onto
   * each wrapper's props so wrappers that key off `msgId` (e.g., for
   * cross-tool coordination later) get a stable identifier. Empty
   * string is acceptable while `activeMsgId` is null — wrapper visual
   * output doesn't depend on it.
   */
  msgId: string;
  className?: string;
}

export type TranscriptToolCallsProps = StaticProps | StreamingProps;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_SLOT_ROOT = "tide-transcript-tool-calls";

/**
 * Sentinel for the "no tool calls" snapshot. Reusing this exact array
 * for every empty-result emission keeps the `Object.is` identity
 * stable across notifications — React's `useSyncExternalStore`
 * tearing check requires it.
 */
const EMPTY_TOOL_CALLS: ReadonlyArray<ToolCallState> = Object.freeze([]);

// ---------------------------------------------------------------------------
// Snapshot hook for streaming mode
// ---------------------------------------------------------------------------

/**
 * Subscribe to `streamingPath` on `streamingStore` and return the
 * parsed `ToolCallState[]` snapshot. Caches by serialized-JSON
 * identity so repeated `getSnapshot` calls between emissions return
 * the same reference (satisfies the [L02] / `useSyncExternalStore`
 * contract that identical store data yields `Object.is`-identical
 * snapshots).
 *
 * Malformed JSON is treated as an empty list — the producer is the
 * reducer's `serializeToolCalls`, which only emits valid arrays, so
 * this branch is purely defense-in-depth for forward-compat / drift.
 */
function useStreamingToolCalls(
  store: PropertyStore,
  path: string,
): ReadonlyArray<ToolCallState> {
  const lastSerializedRef = useRef<string | null>(null);
  const lastParsedRef = useRef<ReadonlyArray<ToolCallState>>(EMPTY_TOOL_CALLS);

  const subscribe = useCallback(
    (listener: () => void) => store.observe(path, listener),
    [store, path],
  );

  const getSnapshot = useCallback((): ReadonlyArray<ToolCallState> => {
    const raw = store.get(path);
    const serialized = typeof raw === "string" ? raw : "[]";
    if (serialized === lastSerializedRef.current) {
      return lastParsedRef.current;
    }

    let parsed: ReadonlyArray<ToolCallState>;
    try {
      const candidate = JSON.parse(serialized) as unknown;
      parsed = Array.isArray(candidate)
        ? (candidate as ReadonlyArray<ToolCallState>)
        : EMPTY_TOOL_CALLS;
    } catch {
      parsed = EMPTY_TOOL_CALLS;
    }

    lastSerializedRef.current = serialized;
    lastParsedRef.current = parsed;
    return parsed;
  }, [store, path]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

// ---------------------------------------------------------------------------
// Inner renderer — shared by both modes
// ---------------------------------------------------------------------------

interface ToolCallsListProps {
  toolCalls: ReadonlyArray<ToolCallState>;
  msgId: string;
  className?: string;
}

const ToolCallsList: React.FC<ToolCallsListProps> = ({
  toolCalls,
  msgId,
  className,
}) => {
  if (toolCalls.length === 0) return null;

  const cls =
    className === undefined
      ? "tide-transcript-tool-calls"
      : `tide-transcript-tool-calls ${className}`;

  return (
    <div className={cls} data-slot={DATA_SLOT_ROOT}>
      {toolCalls.map((toolCall) => {
        const { Component, props } = dispatchToolCallState(toolCall, msgId);
        return <Component key={toolCall.toolUseId} {...props} />;
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Mode dispatch
// ---------------------------------------------------------------------------

const StaticTranscriptToolCalls: React.FC<StaticProps> = ({
  toolCalls,
  msgId,
  className,
}) => (
  <ToolCallsList toolCalls={toolCalls} msgId={msgId} className={className} />
);

const StreamingTranscriptToolCalls: React.FC<StreamingProps> = ({
  streamingStore,
  streamingPath,
  msgId,
  className,
}) => {
  const toolCalls = useStreamingToolCalls(streamingStore, streamingPath);
  return (
    <ToolCallsList toolCalls={toolCalls} msgId={msgId} className={className} />
  );
};

export const TranscriptToolCalls: React.FC<TranscriptToolCallsProps> = (
  props,
) => {
  if ("streamingStore" in props) {
    return <StreamingTranscriptToolCalls {...props} />;
  }
  return <StaticTranscriptToolCalls {...props} />;
};
