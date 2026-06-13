/**
 * `tool-result-summary.ts` — the typed one-line result a tool block
 * reports for its **collapsed** header ([P09] Quiet Line, [#step-11]).
 *
 * The collapsed header answers "what did this do?" in one quiet line. Each
 * collapsed tool provides its result as DATA — a count, a diff stat, an
 * exit code, or a short label — rather than a pre-built badge node, so the
 * collapsed header renders every tool's summary in one consistent, quiet
 * style. (`tool-header-meta`'s badge primitives stay the *expanded*
 * header's metadata cluster; this is the collapsed-line counterpart.)
 *
 * Pure + tiny so the formatting is unit-testable without a DOM.
 *
 * @module components/tugways/cards/tool-blocks/tool-result-summary
 */

import { formatCount } from "./tool-header-meta";

/** A tool call's one-line result, as data. */
export type ToolResultSummary =
  | { kind: "count"; count: number; noun: string; pluralNoun?: string }
  | { kind: "diff"; added: number; removed: number }
  | { kind: "exit"; code: number }
  | { kind: "text"; text: string };

/** Clamp a count to a non-negative integer (mirrors the meta primitives). */
function clampCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
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
