/**
 * `TaskToolBlock` — Layer-2 wrapper for the Task / Agent tool.
 *
 * Composes `ToolBlockChrome` (header / status / error band) around
 * an `embedded` `AgentTranscriptBlock` body kind. Per [Spec S03] /
 * [Table T02] / [#bk-conformance]:
 *
 *   - **Header:** a bot icon + tool name + the subagent type (e.g.
 *     "Explore") and a status badge. The subagent type comes from the
 *     `structured_result.agentType`, falling back to the input's
 *     `subagent_type` while the result is still streaming.
 *   - **Body:** `AgentTranscriptBlock` composed `embedded={true}` —
 *     the wrapper chrome owns identity, so the body kind's own header
 *     is suppressed and its actions cluster (fold cue + Copy) portals
 *     into the chrome's actions slot.
 *
 * Wire shape (`structured_result`, from the v2.1.x stream-json catalog
 * `test-22-subagent-spawn.jsonl`): `{ agentType, status, content:
 * [...], totalDurationMs, totalTokens, totalToolUseCount, toolStats,
 * usage }`. `composeAgentTranscriptData` narrows it to
 * `AgentTranscriptData` — `content[]` entries narrow to
 * `AgentTranscriptEntry` (text answers and nested `tool_use` blocks).
 *
 * Recursion ([D17]): a nested `tool_use` content entry is dispatched
 * by `AgentTranscriptBlock` through the same `dispatchToolCallState`
 * at `depth + 1`, so a nested tool call gets its real wrapper and a
 * nested `Agent` recurses into `TaskToolBlock` → `AgentTranscriptBlock`
 * one level deeper. `depth` arrives on `ToolBlockProps` and is
 * threaded straight to the body kind.
 *
 * Streaming / error:
 *   - `status === "streaming"` → header shows whatever input fragment
 *     has arrived; body is `<StreamingPlaceholder />`.
 *   - `status === "error"` → chrome paints the error band from the
 *     plain-text `tool_result.output`; the body is dropped.
 *   - `status === "ready"` → steady-state render.
 *
 * Registration: `tide-assistant-renderer-dispatch.ts` imports this
 * module and calls `registerToolBlock("agent", TaskToolBlock)` from
 * its own bottom-of-file initialization — the historical `task` name
 * resolves here via the `task → agent` alias ([D16]).
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM attributes;
 *    body composition is pure props derived via `useMemo`.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="task-tool-block"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the body's
 *    `--tugx-agent-*`; the status badge rides the chrome's args-row
 *    typography. No new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — `AgentTranscriptBlock` owns the
 *    transcript rendering, the wrapper owns chrome.
 *  - [D17] recursion runs through the same dispatch, depth-bounded.
 *
 * @module components/tugways/cards/tool-blocks/task-tool-block
 */

import "./task-tool-block.css";

import React from "react";
import { Bot } from "lucide-react";

import {
  AgentTranscriptBlock,
  type AgentTranscriptData,
  type AgentTranscriptEntry,
} from "@/components/tugways/body-kinds/agent-transcript-block";

import type { ToolCallState } from "@/lib/code-session-store";

import {
  StreamingPlaceholder,
  ToolBlockChrome,
} from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings
// ---------------------------------------------------------------------------

/** Task / Agent tool input — the wire fields under `tool_use.input`. */
export interface AgentToolInput {
  /** Short description of the subagent task — not surfaced today. */
  description?: string;
  /** The prompt handed to the subagent — not surfaced today. */
  prompt?: string;
  /** The subagent type (`input.subagent_type`), e.g. "Explore". */
  subagentType?: string;
}

/**
 * Task / Agent tool structured result — the wire shape under
 * `tool_use_structured.structured_result`. Every field is optional and
 * defensively narrowed so a partial / drifted event degrades
 * gracefully. `content` stays `unknown[]` here —
 * `composeAgentTranscriptData` deep-narrows each entry.
 */
export interface AgentStructuredResult {
  agentType?: string;
  status?: string;
  content?: unknown[];
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported because tests pin them
// ---------------------------------------------------------------------------

/** Narrow the wrapper-side `unknown` input to {@link AgentToolInput}. */
export function narrowAgentInput(value: unknown): AgentToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    description:
      typeof v.description === "string" ? v.description : undefined,
    prompt: typeof v.prompt === "string" ? v.prompt : undefined,
    subagentType:
      typeof v.subagent_type === "string" ? v.subagent_type : undefined,
  };
}

/** Narrow the wrapper-side `unknown` structured result. */
export function narrowAgentStructured(value: unknown): AgentStructuredResult {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    agentType: typeof v.agentType === "string" ? v.agentType : undefined,
    status: typeof v.status === "string" ? v.status : undefined,
    content: Array.isArray(v.content) ? v.content : undefined,
    totalDurationMs:
      typeof v.totalDurationMs === "number" ? v.totalDurationMs : undefined,
    totalTokens:
      typeof v.totalTokens === "number" ? v.totalTokens : undefined,
    totalToolUseCount:
      typeof v.totalToolUseCount === "number"
        ? v.totalToolUseCount
        : undefined,
  };
}

/**
 * Narrow one wire `content[]` block to an {@link AgentTranscriptEntry},
 * or `undefined` to drop it. Anthropic content blocks are
 * `{ type: "text", text }` and `{ type: "tool_use", id, name, input }`;
 * a `tool_use` block becomes a `ToolCallState` with no result yet
 * (status `"done"` — the wrapper renders the call without a body).
 * Any other block type is dropped.
 */
function narrowContentEntry(value: unknown): AgentTranscriptEntry | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.type === "text" && typeof v.text === "string") {
    return { kind: "text", text: v.text };
  }
  if (v.type === "tool_use") {
    const id = typeof v.id === "string" ? v.id : undefined;
    const name = typeof v.name === "string" ? v.name : undefined;
    if (id === undefined || name === undefined) return undefined;
    return {
      kind: "tool_use",
      toolCall: {
        toolUseId: id,
        toolName: name,
        input: v.input ?? {},
        status: "done",
        result: null,
        structuredResult: null,
        toolWallMs: null,
      },
    };
  }
  return undefined;
}

/**
 * Compose the `AgentTranscriptData` payload `AgentTranscriptBlock`
 * consumes.
 *
 * Entries come from two sources ([#step-17-5]):
 *  - `childToolCalls` — the subagent's *intermediate* tool calls,
 *    linked by the reducer via `parentToolUseId` and resolved by the
 *    transcript view's `groupToolCallsByParent`. These render first,
 *    in producer order.
 *  - `structured.content[]` — the subagent's *final* answer (text
 *    blocks) plus any inline `tool_use` content blocks. Junk blocks
 *    drop; this follows the intermediate calls.
 *
 * `agentType` falls back to the input's `subagent_type` when the
 * structured result hasn't supplied it yet. Returns `undefined` when
 * the structured result carries nothing renderable at all (drift /
 * streaming-incomplete) — an empty `content` array with any metadata
 * (or any child tool call) still composes.
 */
export function composeAgentTranscriptData(
  input: AgentToolInput,
  structured: AgentStructuredResult,
  childToolCalls?: ReadonlyArray<ToolCallState>,
): AgentTranscriptData | undefined {
  const childEntries: AgentTranscriptEntry[] = (childToolCalls ?? []).map(
    (toolCall) => ({ kind: "tool_use", toolCall }),
  );
  const wireEntries = (structured.content ?? [])
    .map(narrowContentEntry)
    .filter((e): e is AgentTranscriptEntry => e !== undefined);
  const entries = [...childEntries, ...wireEntries];
  const agentType = structured.agentType ?? input.subagentType;
  const data: AgentTranscriptData = {
    agentType,
    status: structured.status,
    durationMs: structured.totalDurationMs,
    toolUseCount: structured.totalToolUseCount,
    totalTokens: structured.totalTokens,
    entries,
  };
  const hasAnything =
    agentType !== undefined ||
    data.status !== undefined ||
    data.durationMs !== undefined ||
    data.toolUseCount !== undefined ||
    data.totalTokens !== undefined ||
    entries.length > 0;
  return hasAnything ? data : undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TaskToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  msgId,
  input,
  structuredResult,
  textOutput,
  status,
  caution,
  depth = 0,
  childToolCallsByParent,
}) => {
  const agentInput = React.useMemo(() => narrowAgentInput(input), [input]);
  const structured = React.useMemo(
    () => narrowAgentStructured(structuredResult),
    [structuredResult],
  );
  // This subagent's own intermediate tool calls — the reducer-linked
  // children whose `parentToolUseId` is this call's `toolUseId`
  // ([#step-17-5]). The full map is threaded on to `AgentTranscriptBlock`
  // so deeper subagents resolve theirs.
  const childToolCalls = React.useMemo(
    () => childToolCallsByParent?.get(toolUseId),
    [childToolCallsByParent, toolUseId],
  );
  const transcriptData = React.useMemo(
    () => composeAgentTranscriptData(agentInput, structured, childToolCalls),
    [agentInput, structured, childToolCalls],
  );

  // Header identity — agent type + status. Read straight from the
  // narrowed shapes (not `transcriptData`) so a still-streaming call
  // can surface the `subagent_type` from its input fragment.
  const agentType = structured.agentType ?? agentInput.subagentType;
  const runStatus = structured.status;
  const argsSummary =
    agentType !== undefined || runStatus !== undefined ? (
      <span className="task-tool-block-args">
        {agentType !== undefined ? (
          <code data-slot="task-tool-block-agent-type">{agentType}</code>
        ) : null}
        {runStatus !== undefined ? (
          <span
            data-slot="task-tool-block-status"
            className="task-tool-block-status"
            data-agent-status={runStatus}
          >
            {runStatus}
          </span>
        ) : null}
      </span>
    ) : undefined;

  // Errored subagent runs carry the failure message in `textOutput`;
  // surface it through the chrome's error band rather than the body.
  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="task-tool-block-error-output">{textOutput}</span>
    ) : undefined;

  // Body: streaming → placeholder; error → none (the chrome's error
  // band is the primary content); ready → the embedded
  // AgentTranscriptBlock when the structured result composed one.
  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else if (status === "error") {
    body = null;
  } else if (transcriptData !== undefined) {
    body = (
      <AgentTranscriptBlock
        data={transcriptData}
        depth={depth}
        msgId={msgId}
        childToolCallsByParent={childToolCallsByParent}
        embedded
        className="task-tool-block-transcript"
        componentStatePreservationKey={`${toolUseId}-body`}
      />
    );
  } else {
    body = null;
  }

  return (
    <ToolBlockChrome
      rootSlot="task-tool-block"
      toolName={toolName}
      toolIcon={<Bot size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolBlockChrome>
  );
};
