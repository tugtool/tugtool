/**
 * session-name.ts — pure presentation helpers for the `/rename` session name
 * ([#step-13d]).
 *
 * The name surfaces in two places, each with its own rule:
 *  - the **Z4B session chip** ({@link sessionChipDisplay}) — the name capped at
 *    {@link SESSION_NAME_CAP} chars (ellipsized), with the full name + raw
 *    `tugSessionId` in the tooltip; falls back to the truncated id when unnamed.
 *  - the **session chooser row** ({@link sessionRowTitle}) — the name when set,
 *    else today's `last_user_prompt`-derived title.
 *
 * Pure string logic — no React, no DOM, no store. Unit-testable in isolation.
 *
 * @module lib/session-name
 */

/** Max chip-value length before ellipsis (matches the terminal's ~16). */
export const SESSION_NAME_CAP = 16;

/** First N chars of a `tugSessionId` — the unnamed-chip fallback. */
export const SESSION_ID_TRUNCATE = 8;

/** Truncate `name` to `cap` chars, appending `…` when it overflows. */
export function truncateSessionName(name: string, cap = SESSION_NAME_CAP): string {
  return name.length <= cap ? name : `${name.slice(0, cap)}…`;
}

/** What the Z4B session chip shows: the visible value + its hover tooltip. */
export interface SessionChipDisplay {
  /** The chip's value line. */
  value: string;
  /** The chip's `title` tooltip. */
  tooltip: string;
}

/**
 * Chip value + tooltip for `(name, tugSessionId)`.
 *
 * - **Named:** value is the name capped at {@link SESSION_NAME_CAP}; tooltip is
 *   the full name plus the raw session id (so the id stays discoverable).
 * - **Unnamed** (`null` / blank): value is the first {@link SESSION_ID_TRUNCATE}
 *   chars of the id; tooltip is the full id — today's behavior unchanged.
 */
export function sessionChipDisplay(
  name: string | null,
  tugSessionId: string,
): SessionChipDisplay {
  const trimmed = name?.trim() ?? "";
  if (trimmed.length === 0) {
    return {
      value: tugSessionId.slice(0, SESSION_ID_TRUNCATE),
      tooltip: tugSessionId,
    };
  }
  return {
    value: truncateSessionName(trimmed),
    tooltip: `${trimmed}\n${tugSessionId}`,
  };
}

/**
 * The session chooser row's title: the name when set, otherwise the
 * `last_user_prompt`-derived `fallback` (the existing title). A blank name is
 * treated as unset.
 */
export function sessionRowTitle(name: string | null, fallback: string): string {
  const trimmed = name?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : fallback;
}
