/**
 * Pure reducer for `CodeSessionStore`.
 *
 * Step 1 ships the identity reducer and the `CodeSessionState` shape;
 * Steps 3–8 populate the real transitions. Every reducer call returns
 * `{ state, effects }`; side effects are processed by the class wrapper.
 *
 * `transcript` intentionally does NOT live here — the class wrapper owns
 * it and appends via `AppendTranscript` effects ([D04] / [D11]).
 */

import type { AtomSegment } from "../tug-atom-img";
import type { Effect } from "./effects";
import type { CodeSessionEvent } from "./events";
import type {
  CodeSessionPhase,
  ControlRequestForward,
  ToolCallState,
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
    queuedSends: [],
    lastError: null,
    lastCostUsd: null,
    claudeSessionId: null,
  };
}

/**
 * Pure reducer. Step 1 is the identity function: returns the same state
 * reference with an empty effect list. Steps 3–8 replace the body with the
 * real transition table.
 */
export function reduce(
  state: CodeSessionState,
  _event: CodeSessionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  return { state, effects: [] };
}
