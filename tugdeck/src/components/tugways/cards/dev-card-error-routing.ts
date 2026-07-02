/**
 * Pure classifier for how `useDevCardObserver` routes a card's
 * `lastError`. Extracted so the branch logic is testable without
 * rendering the hook (the observer itself is a `useLayoutEffect`
 * subscription over real stores).
 *
 * Two causes unbind the card to its picker:
 *   - `auth_gate` — the per-session auth gate found the CLI logged out
 *     or missing (`session_state_errored` with message `auth_required` /
 *     `claude_missing`). The observer re-probes auth and stashes a
 *     `signed_out` notice.
 *   - `resume_failed` — a restore failed; the observer stashes a
 *     `resume_failed` notice.
 * Every other cause routes to the in-card banner and returns `null`.
 */

/** Minimal shape this classifier needs from a `lastError`. */
export interface RoutableCardError {
  cause: string;
  message: string;
}

export type CardErrorRoute = "auth_gate" | "resume_failed" | null;

/** Classify a card `lastError` into its observer route (`null` = not routed). */
export function classifyCardError(err: RoutableCardError | null): CardErrorRoute {
  if (err === null) return null;
  if (
    err.cause === "session_state_errored" &&
    (err.message === "auth_required" || err.message === "claude_missing")
  ) {
    return "auth_gate";
  }
  if (err.cause === "resume_failed") return "resume_failed";
  return null;
}
