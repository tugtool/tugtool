/**
 * `api-retry` — pure classification for the session-card retry notice.
 *
 * Claude Code's SDK retries retryable API failures itself (≤10 attempts,
 * exponential backoff) and announces each attempt on the stream as a
 * `system` event with `subtype: "api_retry"`. The session card only *mirrors*
 * that announcement — it never decides to retry and never inspects status
 * codes on its own.
 *
 * {@link classifyApiRetry} maps the event's `error` category (with the
 * nullable HTTP `error_status` as a secondary signal) to a human label plus
 * a severity. The split matters: `rate_limit` / `overloaded` / 5xx /
 * connection-level failures will plausibly recover, but
 * `authentication_failed` / `billing_error` / `permission_error` will
 * exhaust all attempts and then fail. The transient-notice surface varies
 * tone + copy by severity so the user can tell "this'll clear" from "this is
 * going to die".
 *
 * This module is DOM-free and fully unit-tested; it is the single seam
 * where a future claude error category is slotted in.
 */

/**
 * Whether a retry is expected to recover. `transient` reads as caution
 * (claude is backing off and will likely succeed); `likely-fatal` reads
 * as danger (the failure will exhaust every attempt).
 */
export type ApiRetrySeverity = "transient" | "likely-fatal";

/** The presentation a raw `api_retry` event classifies into. */
export interface ApiRetryClass {
  /** Short human label for the failure category. */
  label: string;
  severity: ApiRetrySeverity;
}

/**
 * Tokens that mark a transport/connection-level failure. The SDK's
 * `api_retry.error` for these arrives as an unrecognized string with no HTTP
 * status (a JSONL audit of real failures showed `ECONNRESET`,
 * `FailedToOpenSocket`, `Connection error`, and timeout-without-status making
 * up ~15% of retries — all of which previously fell through to the bare,
 * alarming "API error"). Matched case-insensitively as substrings so a future
 * variant ("ETIMEDOUT", "socket hang up", …) is caught without a code change.
 */
const NETWORK_ERROR_TOKENS = [
  "econnreset",
  "econnrefused",
  "etimedout",
  "enotfound",
  "epipe",
  "socket",
  "connection",
  "network",
  "disconnect",
  "reset",
  "timed out",
  "fetch failed",
] as const;

function isNetworkError(error: string): boolean {
  const lower = error.toLowerCase();
  return NETWORK_ERROR_TOKENS.some((token) => lower.includes(token));
}

/**
 * Classify an `api_retry` event's `error` category into a label +
 * severity. Keys on the category string; the nullable `errorStatus`
 * disambiguates an unrecognized category that still carries a 5xx
 * (server error → transient). An unrecognized *network*-level failure
 * (no status, connection/socket/timeout signature) reads as the calm,
 * named "Connection lost" rather than the alarming generic. Anything
 * still unknown defaults to transient/"API error" — optimistic, because
 * claude *is* retrying.
 */
export function classifyApiRetry(
  error: string,
  errorStatus: number | null,
): ApiRetryClass {
  switch (error) {
    case "rate_limit":
      return { label: "Rate limited", severity: "transient" };
    case "overloaded":
      return { label: "Servers overloaded", severity: "transient" };
    case "timeout":
      return { label: "Request timed out", severity: "transient" };
    case "api_error":
      return { label: "Server error", severity: "transient" };
    case "authentication_failed":
      return { label: "Authentication failed", severity: "likely-fatal" };
    case "billing_error":
      return { label: "Billing problem", severity: "likely-fatal" };
    case "permission_error":
      return { label: "Permission denied", severity: "likely-fatal" };
    default:
      if (errorStatus !== null && errorStatus >= 500) {
        return { label: "Server error", severity: "transient" };
      }
      if (errorStatus === null && isNetworkError(error)) {
        return { label: "Connection lost", severity: "transient" };
      }
      return { label: "API error", severity: "transient" };
  }
}
