/**
 * rate-limit.ts — pure helpers for the app-level rate-limit banner ([#step-3.5]).
 *
 * The banner reads the account-global subscription quota (a {@link RateLimitInfo}
 * sourced from claude's per-turn `rate_limit_event`) and surfaces a single,
 * transient caution banner only when claude actually signals trouble. This
 * module holds the trigger decision and the reset-countdown formatter as pure
 * functions so the policy is unit-testable on its own, with no store / DOM /
 * React. It mirrors `model-label.ts`.
 *
 * **The status enum is confirmed**, read from the Claude Code CLI's own zod
 * schema (`v2.1.158`):
 *
 *   - `status: "allowed" | "allowed_warning" | "rejected"` — `allowed` = fine,
 *     `allowed_warning` = approaching, `rejected` = hard-limited (requests are
 *     refused; the terminal pops a blocking upgrade / extra-usage menu).
 *   - `overageStatus` mirrors the same enum. The benign default every captured
 *     payload carries is `overageStatus: "rejected"` (`overageDisabledReason:
 *     "org_level_disabled"`) — overage is simply off, NOT an alert. The CLI
 *     warns on overage only when `isUsingOverage && overageStatus ===
 *     "allowed_warning"` ("You're close to your usage limit").
 *
 * So `overageStatus` alone never escalates — keying off it is exactly the bug
 * that made the earlier Z4B chip paint red on a healthy session.
 *
 * Units: `resetsAt` is Unix epoch **seconds** (the wire shape); `now` is
 * milliseconds (`Date.now()`).
 *
 * Pure-functional: no DOM, no React, no module-mutable state.
 *
 * @module lib/rate-limit
 */

import type { RateLimitInfo } from "../protocol";

/** Confirmed `status` / `overageStatus` enum values (CLI v2.1.158 schema). */
const STATUS_ALLOWED = "allowed";
const STATUS_WARNING = "allowed_warning";
const STATUS_REJECTED = "rejected";

/**
 * Banner state derived from the quota. `ok` shows no banner; `approaching`
 * shows a calm caution banner; `limited` shows a danger banner (requests are
 * being refused).
 */
export type RateLimitBannerState = "ok" | "approaching" | "limited";

/**
 * Derive the banner state from the account-global quota ([#step-3.5]):
 *  - `limited`     — `status === "rejected"` (hard limit, requests refused).
 *  - `approaching` — `status === "allowed_warning"`, or the overage-close case
 *                    (`isUsingOverage && overageStatus === "allowed_warning"`).
 *  - `ok`          — everything else, including the benign default
 *                    (`status: "allowed"`, `overageStatus: "rejected"`).
 *
 * `null` (no quota frame yet) is `ok`. `overageStatus` on its own never
 * escalates — only `isUsingOverage && overageStatus === "allowed_warning"`.
 */
export function rateLimitBannerState(
  info: RateLimitInfo | null,
): RateLimitBannerState {
  if (info === null) return "ok";
  if (info.status === STATUS_REJECTED) return "limited";
  if (info.status === STATUS_WARNING) return "approaching";
  if (info.isUsingOverage && info.overageStatus === STATUS_WARNING) {
    return "approaching";
  }
  return "ok";
}

/**
 * Format the time until the window resets as compact countdown text:
 *  - `> 1h`   → `"5h 23m"`
 *  - `< 1h`   → `"23m"`
 *  - `< 1m`   → `"<1m"`
 *  - elapsed  → `"now"`
 *
 * Pure: returns the exact string the banner message embeds. The banner
 * computes it at render from the live `resetsAt`; it does not tick on a timer
 * (one low-frequency app-level surface, refreshed whenever a fresh
 * `rate_limit_event` lands).
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
