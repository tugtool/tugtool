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
  ControlRequestForwardEvent,
  CostUpdateEvent,
  RespondApprovalActionEvent,
  RespondQuestionActionEvent,
  SendActionEvent,
  SessionInitEvent,
  SessionStateErroredEvent,
  ThinkingTextEvent,
  ToolResultEvent,
  ToolUseEvent,
  ToolUseStructuredEvent,
  TurnCompleteEvent,
  WireErrorEvent,
} from "./events";
import type {
  CodeSessionPhase,
  ControlRequestForward,
  CostSnapshot,
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
    cause: "session_state_errored" | "transport_closed" | "wire_error";
    message: string;
    at: number;
  } | null;
  lastCost: CostSnapshot | null;
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
    lastCost: null,
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

  // Mid-turn send — enqueue. The queue is speculative: a single entry
  // flushes at `turn_complete(success)` via the single-tick collapse in
  // `handleTurnComplete`; `interrupt()` clears it per [D05].
  const queuedSends = [
    ...state.queuedSends,
    { text: event.text, atoms: [...event.atoms] },
  ];
  return { state: { ...state, queuedSends }, effects: [] };
}

function handleInterrupt(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  // Idle / errored: no in-flight turn to interrupt. Drop silently so
  // accidental calls from stale UI state don't spam the server with
  // noop interrupt frames.
  if (state.phase === "idle" || state.phase === "errored") {
    return { state, effects: [] };
  }

  // Interrupting from `awaiting_approval` must also abandon the
  // approval prompt: the `interrupt` frame dooms the turn, but the
  // following `turn_complete(error)` is a round-trip away. Between
  // those two moments the UI would otherwise see `pendingApproval`
  // still set and `phase === "awaiting_approval"`, which reads as a
  // live prompt on a dead turn. Clear pending + restore to the pre-
  // approval phase so subscribers observe a coherent
  // "interrupted-tool-work" state until `turn_complete(error)` lands.
  const restoredPhase =
    state.phase === "awaiting_approval"
      ? state.prevPhase ?? "streaming"
      : state.phase;

  return {
    state: {
      ...state,
      phase: restoredPhase,
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      queuedSends: [],
    },
    effects: [{ kind: "send-frame", msg: { type: "interrupt" } }],
  };
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
  const toolName = event.tool_name;
  const incomingInput = (event.input ?? {}) as Record<string, unknown>;

  const toolCallMap = new Map(state.toolCallMap);
  const existing = toolCallMap.get(toolUseId);

  if (existing) {
    // Continuation — Claude streams `tool_use` twice for a logical
    // call (first with `input: {}`, then with the filled-in input).
    // The second event carries the same `tool_name`, so we overwrite
    // freely; only `input` is gated so an empty-object continuation
    // doesn't clobber a previously-filled payload.
    const nextInput =
      Object.keys(incomingInput).length > 0 ? incomingInput : existing.input;
    toolCallMap.set(toolUseId, {
      ...existing,
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
  // Plan's Spec S03 transition table only lists tool_result under the
  // `tool_work → streaming` row — there is no legitimate tool_result in
  // any other phase, so we drop anything else silently.
  if (state.phase !== "tool_work") {
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

  // Single-tick collapse per Spec S03: a queued send on a successful
  // turn flushes in the same dispatch as the commit, so observers see
  // the final phase as `submitting`, not a transient `idle`.
  if (isSuccess && state.queuedSends.length > 0) {
    const [next, ...rest] = state.queuedSends;
    return {
      state: {
        ...state,
        phase: "submitting",
        activeMsgId: null,
        scratch,
        toolCallMap: new Map(),
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        pendingUserMessage: { text: next.text, atoms: next.atoms },
        queuedSends: rest,
        lastError: null,
      },
      effects: [
        { kind: "append-transcript", entry },
        { kind: "clear-inflight" },
        {
          kind: "send-frame",
          msg: {
            type: "user_message",
            text: next.text,
            attachments: [],
          },
        },
      ],
    };
  }

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
      // Error-path queue clear: if a turn errored out without a
      // preceding `interrupt()`, any enqueued follow-ups are dropped.
      // Interrupt-driven paths already cleared the queue.
      queuedSends: isSuccess ? state.queuedSends : [],
      // A successful turn clears any lingering `lastError` from an
      // earlier errored-phase recovery ([Spec S04]).
      lastError: isSuccess ? null : state.lastError,
    },
    effects: [
      { kind: "append-transcript", entry },
      { kind: "clear-inflight" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Control request forward + respond actions
// ---------------------------------------------------------------------------

/**
 * Extract the `ControlRequestForward` fields from the event envelope.
 * Strips `type` so the stored record matches the public type. All other
 * fields (including unknown ones from forward-compat wire versions)
 * pass through so UI code can read `tool_name`, `input`, `options`,
 * `question`, etc.
 */
function extractForward(
  event: ControlRequestForwardEvent,
): ControlRequestForward {
  const { type: _type, ...rest } = event;
  return rest as ControlRequestForward;
}

function handleControlRequestForward(
  state: CodeSessionState,
  event: ControlRequestForwardEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Only meaningful during an active turn. Outside an active phase,
  // silently drop — the reducer stays total and the mid-turn gate
  // tolerates stray forwards from a stale feed replay.
  if (
    state.phase !== "streaming" &&
    state.phase !== "tool_work" &&
    state.phase !== "awaiting_first_token" &&
    state.phase !== "submitting"
  ) {
    return { state, effects: [] };
  }

  const forward = extractForward(event);
  const next: CodeSessionState = {
    ...state,
    phase: "awaiting_approval",
    prevPhase: state.phase,
    pendingApproval: event.is_question ? state.pendingApproval : forward,
    pendingQuestion: event.is_question ? forward : state.pendingQuestion,
  };
  return { state: next, effects: [] };
}

function handleRespondApproval(
  state: CodeSessionState,
  event: RespondApprovalActionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // No pending approval — drop the action. Prevents accidental writes
  // if the UI double-clicks or replays an action after dispose.
  if (state.pendingApproval === null) {
    return { state, effects: [] };
  }

  const restored: CodeSessionPhase = state.prevPhase ?? "streaming";
  const next: CodeSessionState = {
    ...state,
    phase: restored,
    prevPhase: null,
    pendingApproval: null,
  };
  return {
    state: next,
    effects: [
      {
        kind: "send-frame",
        msg: {
          type: "tool_approval",
          request_id: event.request_id,
          decision: event.decision,
          updatedInput: event.updatedInput,
          message: event.message,
        },
      },
    ],
  };
}

function handleRespondQuestion(
  state: CodeSessionState,
  event: RespondQuestionActionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.pendingQuestion === null) {
    return { state, effects: [] };
  }

  const restored: CodeSessionPhase = state.prevPhase ?? "streaming";
  const next: CodeSessionState = {
    ...state,
    phase: restored,
    prevPhase: null,
    pendingQuestion: null,
  };
  return {
    state: next,
    effects: [
      {
        kind: "send-frame",
        msg: {
          type: "question_answer",
          request_id: event.request_id,
          answers: event.answers,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Cost update — telemetry surface, phase-tolerant
// ---------------------------------------------------------------------------

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function handleCostUpdate(
  state: CodeSessionState,
  event: CostUpdateEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Guard against non-numeric total_cost_usd. Live Claude sends a
  // number; the golden loader's `"{{f64}}"` → `0` preprocessing also
  // lands as a number. A string or undefined would mean a wire
  // contract break and the frame is dropped.
  if (typeof event.total_cost_usd !== "number") {
    return { state, effects: [] };
  }

  const lastCost: CostSnapshot = {
    totalCostUsd: event.total_cost_usd,
    numTurns: numericOrNull(event.num_turns),
    durationMs: numericOrNull(event.duration_ms),
    durationApiMs: numericOrNull(event.duration_api_ms),
    usage: event.usage ?? null,
    modelUsage: event.modelUsage ?? null,
  };

  return {
    state: { ...state, lastCost },
    effects: [],
  };
}

// ---------------------------------------------------------------------------
// Errored triggers — Spec S04
// ---------------------------------------------------------------------------

function handleSessionStateErrored(
  state: CodeSessionState,
  event: SessionStateErroredEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Distinct from `interrupted` per [D08]: an errored session is not
  // recoverable via a simple retry — the underlying session is dead.
  // The next `send()` from `errored` re-submits and clears `lastError`
  // on the following `turn_complete(success)`.
  const message = event.detail ?? "session errored";
  return {
    state: {
      ...state,
      phase: "errored",
      lastError: {
        cause: "session_state_errored",
        message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

function handleWireError(
  state: CodeSessionState,
  event: WireErrorEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Distinct from SESSION_STATE errored and transport close. The
  // renderer can dispatch on `lastError.cause === "wire_error"` to
  // surface a different affordance (e.g. a retry button for a
  // `recoverable: true` wire error).
  const message = event.message ?? "wire error";
  return {
    state: {
      ...state,
      phase: "errored",
      lastError: {
        cause: "wire_error",
        message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

function handleTransportClose(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  // Transport close while idle is noise — nothing's in flight, so
  // there's nothing for the user to recover. Re-open handling lives at
  // the connection layer.
  if (state.phase === "idle") {
    return { state, effects: [] };
  }
  return {
    state: {
      ...state,
      phase: "errored",
      lastError: {
        cause: "transport_closed",
        message: "transport closed",
        at: Date.now(),
      },
    },
    effects: [],
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
    case "control_request_forward":
      return handleControlRequestForward(state, event);
    case "respond_approval":
      return handleRespondApproval(state, event);
    case "respond_question":
      return handleRespondQuestion(state, event);
    case "interrupt_action":
      return handleInterrupt(state);
    case "cost_update":
      return handleCostUpdate(state, event);
    case "system_metadata":
      // [D09] SessionMetadataStore owns this feed — drop explicitly.
      return { state, effects: [] };
    case "session_state_errored":
      return handleSessionStateErrored(state, event);
    case "transport_close":
      return handleTransportClose(state);
    case "error":
      return handleWireError(state, event);
    default:
      return { state, effects: [] };
  }
}
