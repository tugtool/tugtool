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
  ReplayCompleteEvent,
  ReplayStartedEvent,
  RespondApprovalActionEvent,
  RespondQuestionActionEvent,
  SendActionEvent,
  SessionInitEvent,
  SessionNotOwnedEvent,
  SessionStateErroredEvent,
  SessionUnknownEvent,
  ThinkingTextEvent,
  ToolResultEvent,
  ToolUseEvent,
  ToolUseStructuredEvent,
  TurnCompleteEvent,
  UserMessageReplayEvent,
  WireErrorEvent,
} from "./events";
import type {
  CodeSessionPhase,
  ControlRequestForward,
  CostSnapshot,
  LastReplayResult,
  ToolCallState,
  TransportState,
  TurnEntry,
} from "./types";

/** Reducer-internal state. Not exposed to consumers. */
export interface CodeSessionState {
  phase: CodeSessionPhase;
  transportState: TransportState;

  tugSessionId: string;
  displayLabel: string;

  activeMsgId: string | null;
  scratch: Map<string, { assistant: string; thinking: string }>;
  toolCallMap: Map<string, ToolCallState>;
  pendingApproval: ControlRequestForward | null;
  pendingQuestion: ControlRequestForward | null;
  prevPhase: CodeSessionPhase | null;
  pendingUserMessage: {
    text: string;
    atoms: ReadonlyArray<AtomSegment>;
    submitAt: number;
  } | null;
  queuedSends: Array<{ text: string; atoms: AtomSegment[] }>;
  lastError: {
    cause:
      | "session_state_errored"
      | "transport_closed"
      | "wire_error"
      | "session_unknown"
      | "session_not_owned"
      | "resume_failed";
    message: string;
    at: number;
  } | null;
  lastCost: CostSnapshot | null;
  /**
   * Set of msg_ids already committed to the transcript. Used to
   * dedupe `turn_complete` events whose msg_id has already produced a
   * TurnEntry — defense-in-depth against a supervisor that
   * accidentally re-emits a turn (a misordered replay-vs-live during
   * a fast reconnect, a manual dev-tool replay) so the worst case is
   * a silent no-op, not a duplicate transcript row.
   *
   * Maintained alongside the class wrapper's `_transcript` array. The
   * reducer adds entries on `turn_complete`; `dispose` and clear
   * paths are owned by the wrapper.
   */
  committedMsgIds: Set<string>;
  /**
   * Outcome of the most recent JSONL replay window. `null` between
   * windows; populated on every `replay_complete` (success and error
   * variants). The class wrapper mirrors this to
   * `CodeSessionSnapshot.lastReplayResult`.
   */
  lastReplayResult: LastReplayResult | null;
}

/** Build the initial state for a freshly constructed store. */
export function createInitialState(
  tugSessionId: string,
  displayLabel: string,
): CodeSessionState {
  return {
    phase: "idle",
    transportState: "online",
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
    committedMsgIds: new Set(),
    lastReplayResult: null,
  };
}

// ---------------------------------------------------------------------------
// Transition handlers
// ---------------------------------------------------------------------------

function handleSend(
  state: CodeSessionState,
  event: SendActionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Submit is gated to idle/errored. While replaying, submit is
  // refused at the snapshot level (`canSubmit: false`); the reducer
  // drops the action defensively in case a UI race fires `send`
  // anyway. The queue is also bypassed — a queued message that
  // commits after replay completes would surprise the user with a
  // dispatch they don't remember initiating.
  if (state.phase === "replaying") {
    return { state, effects: [] };
  }

  if (state.phase === "idle" || state.phase === "errored") {
    const next: CodeSessionState = {
      ...state,
      phase: "submitting",
      pendingUserMessage: {
        text: event.text,
        atoms: event.atoms,
        submitAt: Date.now(),
      },
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

  // Mid-turn send — enqueue. The queue is speculative: a single
  // entry flushes at `turn_complete(success)` via the single-tick
  // collapse in `handleTurnComplete`; `interrupt()` clears it.
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
  _event: SessionInitEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // No state mutation. Tugdeck uses a single session id (`tugSessionId`,
  // chosen by the picker and known from CodeSessionStore construction)
  // for everything user-facing — history keys, picker matching, the
  // sessions record. Claude's `session_init.session_id` is verified to
  // equal `tugSessionId` by the lifecycle log on the wire side; if they
  // ever diverge it's a tugcast/tugcode bug, not something React state
  // has to mirror. Frame is consumed for its lifecycle log only.
  return { state, effects: [] };
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
  // Incoming text outside of an active turn — drop. Live Claude
  // should not emit this, but defensive handling keeps the reducer
  // total. `replaying` is allowed: the JSONL replay translator emits
  // assistant_text / thinking_text events that need to land in
  // scratch keyed by msg_id so the subsequent `turn_complete` can
  // commit them.
  if (
    state.phase !== "submitting" &&
    state.phase !== "awaiting_first_token" &&
    state.phase !== "streaming" &&
    state.phase !== "tool_work" &&
    state.phase !== "replaying"
  ) {
    return { state, effects: [] };
  }

  const msgId = event.msg_id;
  const text = event.text ?? "";
  const scratch = new Map(state.scratch);
  const existing = scratch.get(msgId) ?? { assistant: "", thinking: "" };
  const buffer = event.is_partial ? existing[field] + text : text;
  scratch.set(msgId, { ...existing, [field]: buffer });

  // Phase transitions only fire on live turns. While replaying, the
  // bracket pair owns phase entry/exit — assistant_text accumulates
  // into scratch but does not flip phase. The replay translator
  // emits is_partial: false on every text event, so the live
  // submitting → awaiting_first_token → streaming sequence has no
  // analogue here anyway.
  let nextPhase: CodeSessionPhase;
  if (state.phase === "submitting") {
    nextPhase = "awaiting_first_token";
  } else if (state.phase === "awaiting_first_token") {
    nextPhase = "streaming";
  } else {
    nextPhase = state.phase;
  }

  // While replaying, the in-flight streaming document is not the
  // surface the user reads — replay-committed turns render from
  // `transcript`. Skip the write-inflight effect so a replayed turn's
  // partial text doesn't briefly appear in the in-flight pane.
  const effects: Effect[] =
    state.phase === "replaying"
      ? []
      : [{ kind: "write-inflight", path: inflightPath, value: buffer }];

  return {
    state: {
      ...state,
      phase: nextPhase,
      activeMsgId: msgId,
      scratch,
    },
    effects,
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
    state.phase !== "tool_work" &&
    state.phase !== "replaying"
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

  // Live tool_use flips phase to "tool_work"; replay keeps `replaying`
  // since the bracket pair owns phase entry/exit. The in-flight tool
  // pane similarly only reflects live turns.
  const isReplaying = state.phase === "replaying";
  const effects: Effect[] = isReplaying
    ? []
    : [
        {
          kind: "write-inflight",
          path: "inflight.tools",
          value: serializeToolCalls(toolCallMap),
        },
      ];

  return {
    state: {
      ...state,
      phase: isReplaying ? state.phase : "tool_work",
      activeMsgId: event.msg_id ?? state.activeMsgId,
      toolCallMap,
    },
    effects,
  };
}

function handleToolResult(
  state: CodeSessionState,
  event: ToolResultEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // The transition table only lists tool_result under the
  // `tool_work → streaming` row for live turns. While replaying,
  // tool_result also accepted — it pairs with a prior tool_use that
  // landed in toolCallMap during this same replayed turn.
  if (state.phase !== "tool_work" && state.phase !== "replaying") {
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

  // Live tool_result drives `tool_work → streaming` once every entry
  // is terminal. Replay keeps `replaying`; the bracket's
  // replay_complete returns to idle.
  const isReplaying = state.phase === "replaying";
  const nextPhase: CodeSessionPhase = isReplaying
    ? state.phase
    : allToolsTerminal(toolCallMap)
      ? "streaming"
      : "tool_work";

  const effects: Effect[] = isReplaying
    ? []
    : [
        {
          kind: "write-inflight",
          path: "inflight.tools",
          value: serializeToolCalls(toolCallMap),
        },
      ];

  return {
    state: {
      ...state,
      phase: nextPhase,
      toolCallMap,
    },
    effects,
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
  // turn_complete before any turn started — drop. (The `replaying`
  // phase is excluded from this guard because the replay translator
  // emits `turn_complete` while `replaying`; activeMsgId is set by
  // the preceding `assistant_text` / `tool_use` events.)
  if (
    state.activeMsgId === null &&
    state.phase === "idle"
  ) {
    return { state, effects: [] };
  }

  const msgId = event.msg_id ?? state.activeMsgId ?? "";

  // Dedupe by msg_id. A `turn_complete` whose id is already in
  // `committedMsgIds` is a no-op — defense-in-depth against a
  // supervisor that re-emits a turn (e.g. replay overlapping live).
  // Logged at debug level so a real regression is observable without
  // spamming the console on every legitimate redundant event.
  if (state.committedMsgIds.has(msgId)) {
    if (typeof console !== "undefined") {
      console.debug(
        `[code-session-store] dropping duplicate turn_complete for msg_id=${msgId}`,
      );
    }
    return { state, effects: [] };
  }

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
      submitAt: state.pendingUserMessage?.submitAt ?? Date.now(),
    },
    thinking: scratchEntry.thinking,
    assistant: scratchEntry.assistant,
    // Preserve insertion order: Map.values() iterates in the order
    // entries were inserted via handleToolUse.
    toolCalls: Array.from(state.toolCallMap.values()),
    result: isSuccess ? "success" : "interrupted",
    endedAt: Date.now(),
  };

  const scratch = new Map(state.scratch);
  scratch.delete(msgId);
  const committedMsgIds = new Set(state.committedMsgIds);
  committedMsgIds.add(msgId);

  // While replaying, turn_complete commits a transcript entry but
  // stays in `replaying` — the bracket's terminal `replay_complete`
  // is what returns the phase to `idle`. Skip the queued-send flush
  // (replay produces no queued sends) and the `clear-inflight` effect
  // (replay never wrote to the in-flight streaming document).
  if (state.phase === "replaying") {
    return {
      state: {
        ...state,
        // phase stays `replaying`
        activeMsgId: null,
        scratch,
        toolCallMap: new Map(),
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        pendingUserMessage: null,
        committedMsgIds,
      },
      effects: [{ kind: "append-transcript", entry }],
    };
  }

  // Single-tick collapse: a queued send on a successful turn flushes
  // in the same dispatch as the commit, so observers see the final
  // phase as `submitting`, not a transient `idle`.
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
        pendingUserMessage: {
          text: next.text,
          atoms: next.atoms,
          submitAt: Date.now(),
        },
        queuedSends: rest,
        lastError: null,
        committedMsgIds,
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
      // earlier errored-phase recovery.
      lastError: isSuccess ? null : state.lastError,
      committedMsgIds,
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
// Errored triggers —
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

function handleResumeFailed(
  state: CodeSessionState,
  event: { reason?: string; stale_session_id?: string },
): { state: CodeSessionState; effects: Effect[] } {
  // tugcode emits `resume_failed` and exits; the bridge promotes
  // EOF to a terminal `ResumeFailed` outcome and broadcasts
  // `SESSION_STATE = errored { detail: "resume_failed" }`. Set
  // `lastError` here so the card-side observer (clear binding,
  // re-present picker with notice) can read both the cause and the
  // human-readable reason; the phase flip to `errored` arrives via
  // the subsequent `session_state_errored` event.
  const parts: string[] = [];
  if (event.reason) parts.push(event.reason);
  if (event.stale_session_id) parts.push(`stale id ${event.stale_session_id}`);
  const message = parts.length > 0 ? parts.join("; ") : "resume failed";
  return {
    state: {
      ...state,
      lastError: {
        cause: "resume_failed",
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
  // Idempotence: a duplicate close from the lifecycle (e.g., a stray
  // dispatch during teardown) on an already-offline state is a no-op.
  // Returning the same state reference keeps `getSnapshot()`
  // reference-stable for `useSyncExternalStore`.
  if (state.transportState === "offline") {
    return { state, effects: [] };
  }

  // Transport close from `idle` no longer drops silently — per [D06]
  // the offline transportState gates submit even for cards that had
  // nothing in flight. Phase stays `idle` (there is nothing to error
  // on); `lastError` is left untouched for the same reason.
  if (state.phase === "idle") {
    return {
      state: { ...state, transportState: "offline" },
      effects: [],
    };
  }

  // Non-idle: flip phase to errored and stamp lastError exactly as
  // before, but ALSO record `transportState = "offline"`. The card
  // observer reads phase to surface "errored"; submit gating reads
  // the conjunction of phase ∈ {idle, errored} and transportState.
  return {
    state: {
      ...state,
      phase: "errored",
      transportState: "offline",
      lastError: {
        cause: "transport_closed",
        message: "transport closed",
        at: Date.now(),
      },
    },
    effects: [],
  };
}

function handleTransportOpen(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  // [D08] no-op when already online. The lifecycle layer already
  // gates `connectionDidReconnect` on having seen a prior close, so a
  // `transport_open` against `online` would be a duplicate dispatch
  // (or a bootstrap-time event that arrived before any close). Return
  // the same state ref so subscribers don't observe a churn.
  if (state.transportState === "online") {
    return { state, effects: [] };
  }
  return {
    state: { ...state, transportState: "restoring" },
    effects: [],
  };
}

function handleTransportSettled(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  // Idempotence: settling while already online is a no-op. The
  // `cardSessionBindingStore` subscription path may dispatch this on
  // first bind even when `transportState` was already `online`
  // (initial mount, no transport_close had been observed); skipping
  // the churn keeps the snapshot ref stable.
  if (state.transportState === "online") {
    return { state, effects: [] };
  }
  return {
    state: { ...state, transportState: "online" },
    effects: [],
  };
}

/**
 * Predicate used by the CONTROL-error handlers: a store "owns" an
 * incoming CONTROL error if it is currently waiting on a response to
 * a CODE_INPUT write. This covers `submitting` (just wrote the frame,
 * waiting for Claude's first token) and `awaiting_first_token` (same
 * waiting window, distinct only because a partial might already have
 * arrived in a previous turn context). Other active phases
 * (`streaming`, `tool_work`, `awaiting_approval`) have already
 * received some response from Claude, so a CONTROL error arriving
 * unrouted isn't about the current card's latest write.
 *
 * This gate is the multi-card self-routing mechanism: when the wire
 * frame lacks `tug_session_id` (see `router.rs`'s `session_not_owned`
 * path), every per-card FeedStore's filter lets it through, and each
 * reducer decides on its own whether to accept the routing.
 */
function isAwaitingInputResponse(state: CodeSessionState): boolean {
  return (
    state.phase === "submitting" || state.phase === "awaiting_first_token"
  );
}

function handleSessionUnknown(
  state: CodeSessionState,
  event: SessionUnknownEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // The wire frame carries `tug_session_id`, so the per-card filter
  // already routed it to the correct store. Drop if we're not in a
  // turn that could have triggered it — defensive, because the wire
  // contract says this only fires after a CODE_INPUT write.
  if (!isAwaitingInputResponse(state)) {
    return { state, effects: [] };
  }
  const message = event.detail ?? "session unknown to supervisor";
  return {
    state: {
      ...state,
      phase: "errored",
      lastError: {
        cause: "session_unknown",
        message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

function handleSessionNotOwned(
  state: CodeSessionState,
  event: SessionNotOwnedEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // The wire frame may arrive without `tug_session_id`, so every
  // store's filter saw it. The phase gate picks the one store (or,
  // rarely, small set) that actually issued a CODE_INPUT write in
  // the immediate past.
  if (!isAwaitingInputResponse(state)) {
    return { state, effects: [] };
  }
  const message = event.detail ?? "session not owned by this client";
  return {
    state: {
      ...state,
      phase: "errored",
      lastError: {
        cause: "session_not_owned",
        message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

// ---------------------------------------------------------------------------
// Replay bracket handlers (replay_started / replay_complete /
// user_message_replay)
// ---------------------------------------------------------------------------

/**
 * Open a replay window. Allowed only from `idle` or `errored` —
 * other phases mean a live turn is in flight, which would race the
 * supervisor's flush-before-live ordering. The `errored` case is the
 * explicit invariant: a previously-errored card whose
 * `spawn_session_ok` cleared the error before replay began would
 * already be `idle` by the time `replay_started` lands; this branch
 * exists in case the supervisor sequences differently.
 */
function handleReplayStarted(
  state: CodeSessionState,
  _event: ReplayStartedEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "idle" && state.phase !== "errored") {
    console.warn(
      `[code-session-store] replay_started in unexpected phase ${state.phase}; dropping`,
    );
    return { state, effects: [] };
  }
  return {
    state: {
      ...state,
      phase: "replaying",
      // Clear pendingUserMessage defensively — replay should never
      // observe one (idle/errored have it null), but a future caller
      // that drives `send` then `replay_started` synchronously would
      // otherwise leak the pending message into the first replayed
      // turn's commit.
      pendingUserMessage: null,
      // Same defensive clear for any in-flight scratch / tool state.
      // A live turn racing replay would be a supervisor-side bug,
      // but the reducer leaves no fingerprint of it on the snapshot.
      activeMsgId: null,
      scratch: new Map(),
      toolCallMap: new Map(),
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      // Clear lastReplayResult — the new window is the new outcome.
      lastReplayResult: null,
    },
    effects: [],
  };
}

/**
 * Close a replay window. Always returns to `idle` and populates
 * `lastReplayResult` with the success or error variant. Idempotent:
 * a stray `replay_complete` outside `replaying` is logged and
 * dropped so the normal idle / errored state isn't perturbed.
 */
function handleReplayComplete(
  state: CodeSessionState,
  event: ReplayCompleteEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "replaying") {
    console.warn(
      `[code-session-store] replay_complete in unexpected phase ${state.phase}; dropping`,
    );
    return { state, effects: [] };
  }
  const lastReplayResult: LastReplayResult = event.error
    ? {
        kind: event.error.kind,
        message: event.error.message,
        count: event.count,
        at: Date.now(),
      }
    : {
        kind: "success",
        message: "",
        count: event.count,
        at: Date.now(),
      };
  return {
    state: {
      ...state,
      phase: "idle",
      activeMsgId: null,
      scratch: new Map(),
      toolCallMap: new Map(),
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      pendingUserMessage: null,
      lastReplayResult,
    },
    effects: [],
  };
}

/**
 * Replay user-message echo: the synthetic open of each replayed turn.
 * Sets `pendingUserMessage` so the upcoming `turn_complete` for the
 * same `msg_id` commits a `TurnEntry` with this user submission. No
 * `send-frame` effect — the user already submitted this message
 * historically; replaying it must NOT round-trip back to the wire.
 *
 * Drops in any phase other than `replaying`.
 */
function handleUserMessageReplay(
  state: CodeSessionState,
  event: UserMessageReplayEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "replaying") {
    return { state, effects: [] };
  }
  const attachments: ReadonlyArray<AtomSegment> = (() => {
    const raw = event.attachments;
    return Array.isArray(raw) ? (raw as ReadonlyArray<AtomSegment>) : [];
  })();
  return {
    state: {
      ...state,
      pendingUserMessage: {
        text: event.text,
        atoms: attachments,
        submitAt: Date.now(),
      },
      activeMsgId: event.msg_id,
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
    case "session_unknown":
      return handleSessionUnknown(state, event);
    case "session_not_owned":
      return handleSessionNotOwned(state, event);
    case "transport_close":
      return handleTransportClose(state);
    case "transport_open":
      return handleTransportOpen(state);
    case "transport_settled":
      return handleTransportSettled(state);
    case "error":
      return handleWireError(state, event);
    case "resume_failed":
      return handleResumeFailed(state, event);
    case "replay_started":
      return handleReplayStarted(state, event);
    case "replay_complete":
      return handleReplayComplete(state, event);
    case "user_message_replay":
      return handleUserMessageReplay(state, event);
    default:
      return { state, effects: [] };
  }
}
