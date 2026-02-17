// Control protocol helpers for claude CLI stdin communication.
// Implements the control_request / control_response exchange per D05/D06.
//
// CRITICAL: Permission responses use "behavior" NOT "decision" per PN-1.

// Minimal stdin interface matching the subset of Bun's FileSink we use.
interface StdinSink {
  write(data: unknown): void;
  flush(): void;
}

// ---------------------------------------------------------------------------
// Low-level send helpers
// ---------------------------------------------------------------------------

/**
 * Send a control_request message to claude's stdin.
 * Used for interrupt (D07), model change, and permission mode updates.
 */
export function sendControlRequest(
  stdin: StdinSink,
  requestId: string,
  request: Record<string, unknown>
): void {
  const msg = JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request,
  }) + "\n";
  stdin.write(msg);
  stdin.flush();
}

/**
 * Send a control_response message to claude's stdin.
 * Used to answer control_request messages emitted on stdout (permission prompts,
 * AskUserQuestion, etc.).
 */
export function sendControlResponse(
  stdin: StdinSink,
  response: Record<string, unknown>
): void {
  const msg = JSON.stringify({
    type: "control_response",
    response,
  }) + "\n";
  stdin.write(msg);
  stdin.flush();
}

// ---------------------------------------------------------------------------
// Permission response formatters
// ---------------------------------------------------------------------------

/**
 * Format an "allow" permission response per PN-1.
 * CRITICAL: uses "behavior": "allow" NOT "decision": "allow".
 */
export function formatPermissionAllow(
  requestId: string,
  updatedInput: Record<string, unknown>
): Record<string, unknown> {
  return {
    subtype: "success",
    request_id: requestId,
    response: {
      behavior: "allow",
      updatedInput,
    },
  };
}

/**
 * Format a "deny" permission response per PN-1.
 * CRITICAL: uses "behavior": "deny" NOT "decision": "deny".
 */
export function formatPermissionDeny(
  requestId: string,
  message: string
): Record<string, unknown> {
  return {
    subtype: "success",
    request_id: requestId,
    response: {
      behavior: "deny",
      message,
    },
  };
}

/**
 * Format a question answer response.
 * Merges the answers into the original tool input's questions array.
 * For multiSelect answers, values must be comma-separated labels with NO spaces per PN-5.
 */
export function formatQuestionAnswer(
  requestId: string,
  originalInput: Record<string, unknown>,
  answers: Record<string, string>
): Record<string, unknown> {
  // Merge answers into original input.
  // The updatedInput is the original questions input with answers injected.
  const updatedInput = { ...originalInput, ...answers };
  return {
    subtype: "success",
    request_id: requestId,
    response: {
      behavior: "allow",
      updatedInput,
    },
  };
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique control request ID with "ctrl-" prefix for easy identification.
 */
export function generateRequestId(): string {
  return "ctrl-" + crypto.randomUUID();
}
