/**
 * tide-picker-format — pure formatters for the Tide project picker.
 *
 * Used by the picker's session-resume cells and the inline forget-
 * confirm panel. No React, no JSX — pure string formatting,
 * unit-test-friendly. Lives in its own module so callers in
 * `tide-card.tsx` and `tide-picker-cells.tsx` can both import
 * without forming an import cycle.
 */

import type { SessionRow } from "@/protocol";

/**
 * Truncate a single-line snippet for display in a picker row. Honors
 * Unicode-scalar boundaries (no mid-codepoint slice) and adds an
 * ellipsis when the source exceeds the budget. Newlines and runs of
 * whitespace collapse to single spaces so multi-line prompts read
 * as a single line in the row's title.
 */
export function truncateForDisplay(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, max).join("") + "…";
}

/**
 * Format `then` (unix millis) relative to `now`. Returns short forms:
 * "just now", "Nm ago", "Nh ago", "yesterday", "Nd ago", or a
 * locale-formatted date for anything older than a week.
 */
export function formatRelativeTimestamp(then: number, now: number): string {
  const deltaMs = Math.max(0, now - then);
  const deltaSec = Math.floor(deltaMs / 1_000);
  if (deltaSec < 30) return "just now";
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  if (deltaDay === 1) return "yesterday";
  if (deltaDay < 7) return `${deltaDay}d ago`;
  // Older than a week: locale-formatted short date. Stable across
  // locales for tests via toLocaleDateString without an explicit
  // locale arg.
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Build the subtitle line for a session row: relative timestamp,
 * turn count, and short identifier. The picker shows this under the
 * snippet to give the user enough context to recognize one session
 * vs another.
 */
export function formatSessionRowSubtitle(row: SessionRow): string {
  const turns =
    row.turn_count > 0
      ? `${row.turn_count} ${row.turn_count === 1 ? "turn" : "turns"}`
      : null;
  const ts = formatRelativeTimestamp(row.last_used_at, Date.now());
  const id = `id ${row.session_id}`;
  return [ts, turns, id].filter((p) => p !== null).join(" · ");
}
