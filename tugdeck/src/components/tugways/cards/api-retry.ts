/**
 * `api-retry` — pure presentation helpers for the dev-card retry banner.
 *
 * Claude Code's SDK retries retryable API failures itself (≤10 attempts,
 * exponential backoff) and announces each attempt on the stream as a
 * `system` event with `subtype: "api_retry"`. The dev card only *mirrors*
 * that announcement — it never decides to retry and never inspects status
 * codes on its own. These two pure functions turn the raw event fields
 * into the banner's presentation:
 *
 *  - {@link classifyApiRetry} maps the event's `error` category (with the
 *    nullable HTTP `error_status` as a secondary signal) to a human label
 *    plus a severity. The split matters: `rate_limit` / `overloaded` / 5xx
 *    will plausibly recover, but `authentication_failed` / `billing_error`
 *    / `permission_error` will exhaust all attempts and then fail. The
 *    banner varies tone + copy by severity so the user can tell "this'll
 *    clear" from "this is going to die".
 *  - {@link formatRetryCountdown} renders the backoff deadline as the
 *    short countdown string the banner ticks toward.
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
 * Classify an `api_retry` event's `error` category into a label +
 * severity. Keys on the category string; the nullable `errorStatus`
 * disambiguates an unrecognized category that still carries a 5xx
 * (server error → transient). Unknown categories default to
 * transient/"API error" — optimistic, because claude *is* retrying.
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
      return { label: "API error", severity: "transient" };
  }
}

/**
 * Format the backoff `deadline` (epoch ms) relative to `now` (epoch ms)
 * as the short countdown the banner displays. Whole seconds, rounded up
 * so a sub-second remainder still reads as "1s"; "now" once the deadline
 * has passed (claude's next attempt is imminent).
 */
export function formatRetryCountdown(deadline: number, now: number): string {
  const remainingMs = deadline - now;
  if (remainingMs <= 0) return "now";
  return `${Math.ceil(remainingMs / 1000)}s`;
}
