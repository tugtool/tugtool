/**
 * turn-entry-markdown.ts — serialize a committed assistant `TurnEntry`
 * into a self-contained markdown document.
 *
 * Backs the Z1B COPY affordance on the assistant transcript row. The
 * row body renders the turn's tool calls and the assistant's prose,
 * and COPY is expected to reproduce all of it — not just the final
 * prose. (Thinking is part of the entry but is intentionally left out
 * of the copy.)
 *
 * Output shape — flat sections, tool-agnostic:
 *
 *     ## Tool: <name>
 *
 *     Input:
 *     ```json
 *     { ... }
 *     ```
 *
 *     Output:
 *     ```
 *     ...
 *     ```
 *
 *     ## Response
 *
 *     <assistant prose — verbatim markdown>
 *
 * Every tool call is rendered with the same generic shape, so a tool
 * added later needs no new serialization code. Subagent tool calls
 * (`ToolCallState.parentToolUseId` set) nest one heading level deeper
 * under their spawning `Agent` call.
 *
 * The `## Response` heading is emitted only when the turn also made
 * tool calls — a pure-prose turn copies as just its prose, no heading.
 *
 * @module components/tugways/cards/turn-entry-markdown
 */

import type { ToolCallState, TurnEntry } from "@/lib/code-session-store/types";

import {
  groupToolCallsByParent,
  type GroupedToolCalls,
} from "./tide-card-transcript-tool-calls";

// ---------------------------------------------------------------------------
// Fenced-code helpers
// ---------------------------------------------------------------------------

/** Longest run of consecutive backticks in `s` (0 when there are none). */
function longestBacktickRun(s: string): number {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "`") {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}

/**
 * Wrap `content` in a fenced code block. The fence is one backtick
 * longer than the longest backtick run inside `content` (floored at
 * 3), so a tool output that itself contains ``` fences can't close
 * the block early — CommonMark closes an N-backtick fence only with
 * a run of N-or-more backticks.
 */
function fence(content: string, lang = ""): string {
  const ticks = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  return `${ticks}${lang}\n${content}\n${ticks}`;
}

/** `JSON.stringify` with indentation, guarded against throws / `undefined`. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Per-tool-call serialization
// ---------------------------------------------------------------------------

/** True when a tool input carries nothing worth printing. */
function isEmptyInput(input: unknown): boolean {
  if (input === undefined || input === null) return true;
  if (Array.isArray(input)) return input.length === 0;
  if (typeof input === "object") return Object.keys(input).length === 0;
  return false;
}

/**
 * The `Output:` block body for one tool call. Prefers the raw textual
 * result (`tool_result.output`); falls back to the typed structured
 * result, then to a JSON dump of a non-string raw result, so whichever
 * field a given tool populates, its content lands in the copy.
 */
function toolOutput(call: ToolCallState): string {
  if (typeof call.result === "string" && call.result.length > 0) {
    return fence(call.result);
  }
  if (call.structuredResult !== null && call.structuredResult !== undefined) {
    return fence(safeJson(call.structuredResult), "json");
  }
  if (call.result !== null && call.result !== undefined) {
    return fence(safeJson(call.result), "json");
  }
  return call.status === "pending"
    ? "_(no result — tool was still pending when the turn ended)_"
    : "_(no output)_";
}

/**
 * Serialize one tool call (and, recursively, any subagent children)
 * to a markdown section. `depth` drives the heading level: a top-level
 * call is `##`, each nesting level adds one `#`, clamped at the
 * markdown maximum of `######`.
 */
function serializeToolCall(
  call: ToolCallState,
  depth: number,
  childrenByParent: GroupedToolCalls["childrenByParent"],
): string {
  const hashes = "#".repeat(Math.min(6, 2 + depth));
  const lines: string[] = [`${hashes} Tool: ${call.toolName}`];

  if (!isEmptyInput(call.input)) {
    lines.push("", "Input:", fence(safeJson(call.input), "json"));
  }
  lines.push("", "Output:", toolOutput(call));

  const children = childrenByParent.get(call.toolUseId) ?? [];
  for (const child of children) {
    lines.push("", serializeToolCall(child, depth + 1, childrenByParent));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a committed assistant `TurnEntry` to a markdown document
 * covering every tool call followed by the assistant's prose. Returns
 * an empty string for a turn with neither (the COPY affordance is
 * suppressed for an empty result by its own length check).
 */
export function turnEntryToMarkdown(turn: TurnEntry): string {
  const { topLevel, childrenByParent } = groupToolCallsByParent(
    turn.toolCalls,
  );

  const sections: string[] = topLevel.map((call) =>
    serializeToolCall(call, 0, childrenByParent),
  );

  const prose = turn.assistant.trim();
  if (prose.length > 0) {
    // A heading delimits the prose from the tool sections above it;
    // a pure-prose turn copies as just its prose, with no heading.
    sections.push(sections.length > 0 ? `## Response\n\n${prose}` : prose);
  }

  return sections.join("\n\n");
}
