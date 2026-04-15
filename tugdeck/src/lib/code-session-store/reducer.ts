/**
 * Pure reducer for `CodeSessionStore`.
 *
 * Step 3 implements the basic `idle → submitting → awaiting_first_token
 * → streaming → idle` round-trip. Later steps extend this with streaming
 * delta accumulation (4), tool lifecycle (5), control forwards (6),
 * interrupt + queue (7), and errored triggers (8).
 *
 * `transcript` intentionally does NOT live here — the class wrapper
 * owns it and appends via `AppendTranscript` effects ([D04] / [D11]).
 */

import type { AtomSegment } from "../tug-atom-img";
import type { Effect, InflightPath } from "./effects";
import type {
  AssistantTextEvent,
  CodeSessionEvent,
  SendActionEvent,
  SessionInitEvent,
  ThinkingTextEvent,
  ToolResultEvent,
  ToolUseEvent,
  ToolUseStructuredEvent,
  TurnCompleteEvent,
} from "./events";
import type {
  CodeSessionPhase,
  ControlRequestForward,
  ToolCallState,
  TurnEntry,
} from "./types";

/** Reducer-internal state. Not exposed to consumers. */
export interface CodeSessionState {
  phase: CodeSessionPhase;

  tugSessionId: string;
  displayLabel: string;

  activeMsgId: string | null;
  scratch: Map<string, { assistant: string; thinking: string }>;
  toolCallMap: Map<string, ToolCallState>;
  pendingApproval: ControlRequestForward | null;
  pendingQuestion: ControlRequestForward | null;
  prevPhase: CodeSessionPhase | null;
  pendingUserMessage: { text: string; atoms: ReadonlyArray<AtomSegment> } | null;
  queuedSends: Array<{ text: string; atoms: AtomSegment[] }>;
  lastError: {
    cause: "session_state_errored" | "transport_closed";
    message: string;
    at: number;
  } | null;
  lastCostUsd: number | null;
  claudeSessionId: string | null;
}

/** Build the initial state for a freshly constructed store. */
export function createInitialState(
  tugSessionId: string,
  displayLabel: string,
): CodeSessionState {
  return {
    phase: "idle",
    tugSessionId,
    displayLabel,
    activeMsgId: null,
    scratch: new Map(),
    toolCallMap: new Map(),
    pendingApproval: null,
    pendingQuestion: null,
    prevPhase: null,
    pendingUserMessage: null,
    queuedSends: [],
    lastError: null,
    lastCostUsd: null,
    claudeSessionId: null,
  };
}

// ---------------------------------------------------------------------------
// Transition handlers
// ---------------------------------------------------------------------------

function handleSend(
  state: CodeSessionState,
  event: SendActionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase === "idle" || state.phase === "errored") {
    const next: CodeSessionState = {
      ...state,
      phase: "submitting",
      pendingUserMessage: { text: event.text, atoms: event.atoms },
    };
    return {
      state: next,
      effects: [
        {
          kind: "send-frame",
          msg: {
            type: "user_message",
            text: event.text,
            attachments: [],
          },
        },
      ],
    };
  }

  // Non-idle, non-errored: Step 7 adds queue semantics. For Step 3 we
  // drop mid-turn sends silently — the Step 3 test never triggers this
  // branch.
  return { state, effects: [] };
}

function handleSessionInit(
  state: CodeSessionState,
  event: SessionInitEvent,
): { state: CodeSessionState; effects: Effect[] } {
  const sessionId = event.session_id;
  if (typeof sessionId !== "string") return { state, effects: [] };
  if (state.claudeSessionId === sessionId) return { state, effects: [] };
  return {
    state: { ...state, claudeSessionId: sessionId },
    effects: [],
  };
}

/**
 * Shared delta-accumulation logic for `assistant_text` and
 * `thinking_text`. Both events share structure: a partial accumulates
 * into the matching scratch field and a terminal frame
 * (`is_partial: false`) replaces the scratch buffer with the
 * authoritative full text. The first partial of either kind drives the
 * `submitting → awaiting_first_token` transition; the next drives
 * `awaiting_first_token → streaming`.
 */
function handleTextDelta(
  state: CodeSessionState,
  event: AssistantTextEvent | ThinkingTextEvent,
  field: "assistant" | "thinking",
  inflightPath: InflightPath,
): { state: CodeSessionState; effects: Effect[] } {
  // Incoming text outside of an active turn — drop. Live Claude should
  // not emit this, but defensive handling keeps the reducer total.
  if (
    state.phase !== "submitting" &&
    state.phase !== "awaiting_first_token" &&
    state.phase !== "streaming" &&
    state.phase !== "tool_work"
  ) {
    return { state, effects: [] };
  }

  const msgId = event.msg_id;
  const text = event.text ?? "";
  const scratch = new Map(state.scratch);
  const existing = scratch.get(msgId) ?? { assistant: "", thinking: "" };
  const buffer = event.is_partial ? existing[field] + text : text;
  scratch.set(msgId, { ...existing, [field]: buffer });

  let nextPhase: CodeSessionPhase;
  if (state.phase === "submitting") {
    nextPhase = "awaiting_first_token";
  } else if (state.phase === "awaiting_first_token") {
    nextPhase = "streaming";
  } else {
    nextPhase = state.phase;
  }

  return {
    state: {
      ...state,
      phase: nextPhase,
      activeMsgId: msgId,
      scratch,
    },
    effects: [
      {
        kind: "write-inflight",
        path: inflightPath,
        value: buffer,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tool call lifecycle
// ---------------------------------------------------------------------------

/**
 * Serialize the current toolCallMap values into the JSON string the
 * `inflight.tools` PropertyStore path holds. Insertion order is
 * preserved by `Map.values()`.
 */
function serializeToolCalls(
  toolCallMap: ReadonlyMap<string, ToolCallState>,
): string {
  return JSON.stringify(Array.from(toolCallMap.values()));
}

/**
 * Predicate driving the `tool_work → streaming` transition: every
 * entry must be terminal (`done` or `error`). An empty map counts as
 * "all done" but the reducer only calls this after a state-changing
 * tool event, so the empty case never triggers a spurious return.
 */
function allToolsTerminal(
  toolCallMap: ReadonlyMap<string, ToolCallState>,
): boolean {
  for (const entry of toolCallMap.values()) {
    if (entry.status !== "done" && entry.status !== "error") {
      return false;
    }
  }
  return true;
}

function handleToolUse(
  state: CodeSessionState,
  event: ToolUseEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (
    state.phase !== "submitting" &&
    state.phase !== "awaiting_first_token" &&
    state.phase !== "streaming" &&
    state.phase !== "tool_work"
  ) {
    return { state, effects: [] };
  }

  const toolUseId = event.tool_use_id;
  const toolName = event.tool_name ?? "";
  const incomingInput = (event.input ?? {}) as Record<string, unknown>;

  const toolCallMap = new Map(state.toolCallMap);
  const existing = toolCallMap.get(toolUseId);

  if (existing) {
    // Continuation — Claude streams `tool_use` twice for a logical
    // call (first with `input: {}`, then with the filled-in input).
    // Preserve status and accumulated fields; only overwrite `input`
    // when the incoming payload has keys.
    const nextInput =
      Object.keys(incomingInput).length > 0 ? incomingInput : existing.input;
    toolCallMap.set(toolUseId, {
      ...existing,
      toolName: toolName !== "" ? toolName : existing.toolName,
      input: nextInput,
    });
  } else {
    toolCallMap.set(toolUseId, {
      toolUseId,
      toolName,
      input: incomingInput,
      status: "pending",
      result: null,
      structuredResult: null,
    });
  }

  return {
    state: {
      ...state,
      phase: "tool_work",
      activeMsgId: event.msg_id ?? state.activeMsgId,
      toolCallMap,
    },
    effects: [
      {
        kind: "write-inflight",
        path: "inflight.tools",
        value: serializeToolCalls(toolCallMap),
      },
    ],
  };
}

function handleToolResult(
  state: CodeSessionState,
  event: ToolResultEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "tool_work" && state.phase !== "streaming") {
    return { state, effects: [] };
  }

  const toolUseId = event.tool_use_id;
  const existing = state.toolCallMap.get(toolUseId);
  if (!existing) {
    console.warn(
      `[code-session-store] tool_result for unknown tool_use_id: ${toolUseId}`,
    );
    return { state, effects: [] };
  }

  const toolCallMap = new Map(state.toolCallMap);
  toolCallMap.set(toolUseId, {
    ...existing,
    status: event.is_error === true ? "error" : "done",
    result: event.output ?? null,
  });

  const nextPhase: CodeSessionPhase = allToolsTerminal(toolCallMap)
    ? "streaming"
    : "tool_work";

  return {
    state: {
      ...state,
      phase: nextPhase,
      toolCallMap,
    },
    effects: [
      {
        kind: "write-inflight",
        path: "inflight.tools",
        value: serializeToolCalls(toolCallMap),
      },
    ],
  };
}

function handleToolUseStructured(
  state: CodeSessionState,
  event: ToolUseStructuredEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "tool_work" && state.phase !== "streaming") {
    return { state, effects: [] };
  }

  const toolUseId = event.tool_use_id;
  const existing = state.toolCallMap.get(toolUseId);
  if (!existing) {
    console.warn(
      `[code-session-store] tool_use_structured for unknown tool_use_id: ${toolUseId}`,
    );
    return { state, effects: [] };
  }

  const toolCallMap = new Map(state.toolCallMap);
  toolCallMap.set(toolUseId, {
    ...existing,
    structuredResult: event.structured_result ?? null,
  });

  return {
    state: { ...state, toolCallMap },
    effects: [
      {
        kind: "write-inflight",
        path: "inflight.tools",
        value: serializeToolCalls(toolCallMap),
      },
    ],
  };
}

function handleTurnComplete(
  state: CodeSessionState,
  event: TurnCompleteEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // turn_complete before any turn started — drop.
  if (state.activeMsgId === null && state.phase === "idle") {
    return { state, effects: [] };
  }

  const msgId = event.msg_id ?? state.activeMsgId ?? "";
  const scratchEntry = state.scratch.get(msgId) ?? {
    assistant: "",
    thinking: "",
  };

  const isSuccess = event.result === "success";
  const entry: TurnEntry = {
    msgId,
    userMessage: {
      text: state.pendingUserMessage?.text ?? "",
      attachments: state.pendingUserMessage?.atoms ?? [],
    },
    thinking: scratchEntry.thinking,
    assistant: scratchEntry.assistant,
    // Preserve insertion order ([Q02]): Map.values() iterates in the
    // order entries were inserted via handleToolUse.
    toolCalls: Array.from(state.toolCallMap.values()),
    result: isSuccess ? "success" : "interrupted",
    endedAt: Date.now(),
  };

  const scratch = new Map(state.scratch);
  scratch.delete(msgId);

  return {
    state: {
      ...state,
      phase: "idle",
      activeMsgId: null,
      scratch,
      toolCallMap: new Map(),
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      pendingUserMessage: null,
    },
    effects: [
      { kind: "append-transcript", entry },
      { kind: "clear-inflight" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Pure reducer. Returns the next state and an ordered effect list; the
 * class wrapper in `code-session-store.ts` processes the effects.
 */
export function reduce(
  state: CodeSessionState,
  event: CodeSessionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  switch (event.type) {
    case "send":
      return handleSend(state, event);
    case "session_init":
      return handleSessionInit(state, event);
    case "assistant_text":
      return handleTextDelta(state, event, "assistant", "inflight.assistant");
    case "thinking_text":
      return handleTextDelta(state, event, "thinking", "inflight.thinking");
    case "tool_use":
      return handleToolUse(state, event);
    case "tool_result":
      return handleToolResult(state, event);
    case "tool_use_structured":
      return handleToolUseStructured(state, event);
    case "turn_complete":
      return handleTurnComplete(state, event);
    case "system_metadata":
      // [D09] SessionMetadataStore owns this feed — drop explicitly.
      return { state, effects: [] };
    case "session_state_errored":
    case "transport_close":
      // Step 8 placeholders.
      return { state, effects: [] };
    default:
      return { state, effects: [] };
  }
}
