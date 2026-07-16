/**
 * session-name.ts — pure presentation helpers for the `/rename` session name
 * ([#step-13d]).
 *
 * The name surfaces in two places, each with its own rule:
 *  - the **Z4B session chip** ({@link sessionChipDisplay}) — the name capped at
 *    {@link SESSION_NAME_CAP} chars (ellipsized), with the full name + raw
 *    `tugSessionId` in the tooltip; falls back to the mnemonic tag, then the
 *    truncated id, when unnamed.
 *  - the **session chooser row** ({@link sessionRowTitle}) — the name when set,
 *    else the tag, else today's `last_user_prompt`-derived title.
 *
 * Precedence in both: user `/rename` name → mnemonic tag → truncated UUID /
 * prompt fallback. The tag is the default friendly face; the UUID is the
 * last-resort fallback a legacy tagless session still degrades to.
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
 * Chip value + tooltip for `(name, tag, tugSessionId)`, precedence
 * name → tag → truncated UUID.
 *
 * - **Named:** value is the name capped at {@link SESSION_NAME_CAP}; tooltip is
 *   the full name plus the raw session id (so the id stays discoverable).
 * - **Unnamed but tagged:** value is the tag (well under the cap, but capped for
 *   safety); tooltip is the tag plus the raw id.
 * - **Unnamed and untagged** (`null` / blank): value is the first
 *   {@link SESSION_ID_TRUNCATE} chars of the id; tooltip is the full id —
 *   today's behavior unchanged for a legacy tagless session.
 */
export function sessionChipDisplay(
  name: string | null,
  tag: string | null,
  tugSessionId: string,
): SessionChipDisplay {
  const trimmedName = name?.trim() ?? "";
  if (trimmedName.length > 0) {
    return {
      value: truncateSessionName(trimmedName),
      tooltip: `${trimmedName}\n${tugSessionId}`,
    };
  }
  const trimmedTag = tag?.trim() ?? "";
  if (trimmedTag.length > 0) {
    return {
      value: truncateSessionName(trimmedTag),
      tooltip: `${trimmedTag}\n${tugSessionId}`,
    };
  }
  return {
    value: tugSessionId.slice(0, SESSION_ID_TRUNCATE),
    tooltip: tugSessionId,
  };
}

/**
 * The session chooser row's title, precedence name → tag → `fallback`: the name
 * when set, else the mnemonic tag, else the `last_user_prompt`-derived
 * `fallback` (the existing title). Blank name/tag are treated as unset.
 */
export function sessionRowTitle(
  name: string | null,
  tag: string | null,
  fallback: string,
): string {
  const trimmedName = name?.trim() ?? "";
  if (trimmedName.length > 0) return trimmedName;
  const trimmedTag = tag?.trim() ?? "";
  if (trimmedTag.length > 0) return trimmedTag;
  return fallback;
}
