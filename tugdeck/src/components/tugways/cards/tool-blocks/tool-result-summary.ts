/**
 * `tool-result-summary.ts` — the typed one-line result a tool block
 * reports as its header's trailing info.
 *
 * The header answers "what did this do?" in one quiet line, rendered the
 * same plain way in both the collapsed and expanded states. Each tool
 * provides its result as DATA — a count, a diff stat, an exit code, or a
 * short label — rather than a pre-built badge node, so every tool's summary
 * reads in one consistent, quiet style.
 *
 * Pure + tiny so the formatting is unit-testable without a DOM.
 *
 * @module components/tugways/cards/tool-blocks/tool-result-summary
 */

/** A tool call's one-line result, as data. */
export type ToolResultSummary =
  | { kind: "count"; count: number; noun: string; pluralNoun?: string }
  | { kind: "diff"; added: number; removed: number }
  | { kind: "exit"; code: number }
  | { kind: "text"; text: string };

/** Clamp a count to a non-negative integer. */
function clampCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Format a localized count label: `formatCount(100, "file")` →
 * `"100 files"`, `formatCount(1, "match", "matches")` → `"1 match"`.
 * Pluralizes by appending `s` to `noun` when `pluralNoun` is omitted;
 * thousands-group via `toLocaleString`. Negative / non-finite counts
 * clamp to `0`.
 */
export function formatCount(
  count: number,
  noun: string,
  pluralNoun?: string,
): string {
  const n = clampCount(count);
  const word = n === 1 ? noun : (pluralNoun ?? `${noun}s`);
  return `${n.toLocaleString()} ${word}`;
}

/**
 * Render a result summary to its quiet one-line string:
 * `{count:110,noun:"line"}` → `"110 lines"`, `{diff:42,7}` → `"+42 −7"`,
 * `{exit:1}` → `"exit 1"`, `{text:"committed"}` → `"committed"`.
 */
export function formatToolResultSummary(summary: ToolResultSummary): string {
  switch (summary.kind) {
    case "count":
      return formatCount(summary.count, summary.noun, summary.pluralNoun);
    case "diff":
      return `+${clampCount(summary.added)} −${clampCount(summary.removed)}`;
    case "exit":
      return `exit ${summary.code}`;
    case "text":
      return summary.text;
  }
}
