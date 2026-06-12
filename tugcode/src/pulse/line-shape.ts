/**
 * Commentator line-shape enforcement — the defensive layer between
 * model output and the wire. The prompt asks for one line ≤110 chars
 * and `PASS` on uneventful beats; this module guarantees those shapes
 * hold even when the model overruns.
 *
 * @module pulse/line-shape
 */

/** Hard cap from the prompt contract; clipped with an ellipsis. */
export const MAX_LINE_CHARS = 110;

/** The model's decline token — an accepted beat with no line. */
export const PASS_TOKEN = "PASS";

/**
 * Normalize a raw model reply into an emittable line, or null when
 * the beat produced nothing (PASS, empty, whitespace).
 */
export function shapeLine(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  // First non-empty line only — a multi-line overrun keeps its lead.
  const first = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (first === undefined) return null;
  if (first === PASS_TOKEN) return null;
  if (first.length <= MAX_LINE_CHARS) return first;
  return `${first.slice(0, MAX_LINE_CHARS - 1)}…`;
}
