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
 *
 * When the user picked a durable scope ("Allow for this project", etc.)
 * the chosen `permission_suggestions` entry is round-tripped back as
 * `updatedPermissions` (the SDK `PermissionResult.updatedPermissions`
 * field, `PermissionUpdate[]`); the CLI records the rule at its
 * `destination`. Omitted for a plain "Allow once" so no rule is added.
 */
export function formatPermissionAllow(
  requestId: string,
  updatedInput: Record<string, unknown>,
  updatedPermissions?: unknown[]
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    behavior: "allow",
    updatedInput,
  };
  if (updatedPermissions !== undefined && updatedPermissions.length > 0) {
    response.updatedPermissions = updatedPermissions;
  }
  return {
    subtype: "success",
    request_id: requestId,
    response,
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
 *
 * Two mutually-exclusive outcomes, both wrapped in the same `behavior: "allow"`
 * success envelope:
 *  - Answer (`answers` given): nest the answers under an "answers" key in
 *    updatedInput per §5b. The key is the question text, the value is the
 *    selected option label (free text rides here verbatim too). For
 *    multiSelect: comma-separated labels with NO spaces per PN-5.
 *  - Decline (`response` given): the user dismissed the structured questions
 *    and replied in prose (`Chat about this`). Emit `{ ...originalInput,
 *    response }` so Claude reads it as a freeform reply and the tool resolves
 *    (distinct from an interrupt). `response` wins over `answers` when both
 *    are somehow present — a decline supersedes an answer.
 */
export function formatQuestionAnswer(
  requestId: string,
  originalInput: Record<string, unknown>,
  answers: Record<string, string> | undefined,
  response?: string
): Record<string, unknown> {
  const updatedInput =
    response !== undefined
      ? { ...originalInput, response }
      : { ...originalInput, answers: answers ?? {} };
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
