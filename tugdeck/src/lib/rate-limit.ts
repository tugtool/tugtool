/**
 * rate-limit.ts — pure helpers for the Z4B rate-limit chip ([#step-3]).
 *
 * The chip reads `SessionMetadataSnapshot.rateLimit` (a {@link RateLimitInfo}
 * sourced from claude's per-turn `rate_limit_event`) and surfaces the time
 * until the subscription window resets, escalating its colour as the quota
 * tightens. This module holds the decisions that drive that — visibility,
 * severity, and the countdown text — as pure functions so the policy is
 * unit-testable on its own, with no store / DOM / React. It mirrors
 * `model-label.ts`: the chip rendering and the live feed round-trip are the
 * real-app test's job.
 *
 * Units: `resetsAt` is Unix epoch **seconds** (the wire shape); `now` is
 * milliseconds (`Date.now()`). Each helper converts internally so callers
 * pass the value they already have.
 *
 * Pure-functional: no DOM, no React, no module-mutable state.
 *
 * @module lib/rate-limit
 */

import type { RateLimitInfo } from "../protocol";

/** The wire `status` value meaning the quota is fine. */
const STATUS_ALLOWED = "allowed";
/** The wire `status` value meaning the quota is close but not exhausted. */
const STATUS_WARNING = "warning";

/**
 * How close to the reset (in ms) an otherwise-`allowed` quota must be for
 * the chip to surface anyway — a gentle "your window resets soon" heads-up.
 * Outside this window an allowed quota shows no chip. Per [#step-3] /
 * [#q02-rate-limit-store]: hidden when `status === "allowed"` && reset is
 * more than 60 min out.
 */
export const RATE_LIMIT_NEAR_RESET_MS = 60 * 60 * 1000;

/**
 * Countdown tick period (ms). The chip rewrites its countdown text on this
 * cadence via direct DOM mutation per [L22] — never through React. One
 * minute is the finest granularity the `Xh Ym` / `Ym` format shows.
 */
export const RATE_LIMIT_TICK_MS = 60 * 1000;

/**
 * Chip severity, mapped to a `TugBadge` role by the chip ([#step-3]):
 * `rest` → `agent`, `caution` → `caution`, `danger` → `danger`. The
 * rate-limit chip is the one Z4B chip whose role is state-driven ([D01]).
 */
export type RateLimitSeverity = "rest" | "caution" | "danger";

/**
 * True when the quota is actually blocking new work — the window is
 * exhausted (`status` is neither `allowed` nor `warning`, e.g. `exceeded`).
 * The chip shows a static "Rate-limited" face in this state rather than a
 * countdown, since no turn can run to refresh it until the window resets.
 */
export function isRateLimitExhausted(info: RateLimitInfo): boolean {
  return info.status !== STATUS_ALLOWED && info.status !== STATUS_WARNING;
}

/**
 * Severity for the chip's role escalation:
 *  - `danger`  — the window is exhausted, or overage is rejected (the user
 *                cannot even spill into overage allotment);
 *  - `caution` — a `warning` status, or the turn is already consuming
 *                overage allotment;
 *  - `rest`    — allowed and not on overage (the chip is only visible
 *                because the reset is near).
 */
export function rateLimitSeverity(info: RateLimitInfo): RateLimitSeverity {
  if (isRateLimitExhausted(info) || info.overageStatus === "rejected") {
    return "danger";
  }
  if (info.status === STATUS_WARNING || info.isUsingOverage) {
    return "caution";
  }
  return "rest";
}

/**
 * Visibility predicate per [#step-3]: hidden when `status === "allowed"`
 * and the reset is more than {@link RATE_LIMIT_NEAR_RESET_MS} away; visible
 * for every non-allowed status, and for an allowed status whose reset is
 * within the window. `null` (no quota frame yet) is never visible.
 */
export function isRateLimitChipVisible(
  info: RateLimitInfo | null,
  nowMs: number,
): boolean {
  if (info === null) return false;
  if (info.status !== STATUS_ALLOWED) return true;
  const resetsAtMs = info.resetsAt * 1000;
  return resetsAtMs - nowMs <= RATE_LIMIT_NEAR_RESET_MS;
}

/**
 * Format the time until the window resets as compact countdown text:
 *  - `> 1h`   → `"5h 23m"`
 *  - `< 1h`   → `"23m"`
 *  - `< 1m`   → `"<1m"`
 *  - elapsed  → `"now"`
 *
 * Pure: returns the exact string the chip writes into the countdown span,
 * both on the initial render and on each [L22] tick.
 */
export function formatResetCountdown(resetsAtSec: number, nowMs: number): string {
  const deltaSec = resetsAtSec - Math.floor(nowMs / 1000);
  if (deltaSec <= 0) return "now";
  const totalMin = Math.floor(deltaSec / 60);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return "<1m";
}

/**
 * The chip's content text: a static "Rate-limited" when the window is
 * exhausted (no countdown can usefully tick down to a usable state), else
 * the live reset countdown. The exhausted face is the terminal step of the
 * plan's `"5h 23m" → "59m" → "rate-limited"` progression.
 */
export function rateLimitContent(info: RateLimitInfo, nowMs: number): string {
  if (isRateLimitExhausted(info)) return "Rate-limited";
  return formatResetCountdown(info.resetsAt, nowMs);
}
