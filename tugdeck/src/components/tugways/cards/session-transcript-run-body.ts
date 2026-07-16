/**
 * session-transcript-run-body.ts — classify an assistant run's message
 * slice into whether it paints any *user-facing* content, and if not,
 * what fallback the transcript should render in its place.
 *
 * An assistant row renders one maximal contiguous run of non-user
 * Messages (see `session-transcript-data-source.ts`). Some runs paint no
 * user-facing ink at all: a self-paced wait loop, for instance, emits
 * turns whose only Messages are a (collapsed, supplementary) thinking
 * block plus a `ScheduleWakeup` — a `hidden`-policy tool that resolves
 * to `NullToolBlock` and paints zero ink. Rendered naively, that row is
 * the attribution chrome (`#a{N}` badge, model label, timestamp) over an
 * empty body — an "assistant message with no content."
 *
 * This classifier lets the body renderer replace that emptiness with a
 * legible marker instead of a blank bubble:
 *
 *  - `plumbing` — the run's only actions were `hidden`-policy tools
 *    (ScheduleWakeup, ToolSearch, …), with no assistant text and no
 *    visible tool. The row shows a subtle inline marker per hidden tool
 *    ("Scheduled a wake-up") so the invisible plumbing reads as a trace.
 *    Any thinking chip in the run still renders alongside it.
 *  - `empty` — the run produced nothing at all: no text, no thinking, no
 *    tool calls. A turn that ended blank (interrupted / malformed
 *    stream). The row shows a canned placeholder so the anomaly is
 *    surfaced rather than hidden.
 *  - `none` — the run has user-facing content (non-empty assistant text
 *    OR a visible tool call), or only a thinking chip, which is content
 *    enough. No fallback; render as-is.
 *
 * "Thinking counts as content" only for the `empty` distinction: a
 * thinking-only run renders its chip and takes no marker, but thinking
 * alone does NOT make a hidden-tool run look non-empty — the plumbing
 * marker still fires so the user sees what the turn did.
 *
 * @module components/tugways/cards/session-transcript-run-body
 */

import type { Message } from "@/lib/code-session-store";

import { resolveToolBlock, NullToolBlock } from "./session-assistant-renderer-dispatch";

/**
 * User-legible phrase for a `hidden`-policy tool whose per-call events
 * paint zero transcript ink. Keyed by lowercased tool name. A hidden
 * tool with no entry falls back to `Ran <toolName>` (see `markerLabel`).
 */
const HIDDEN_TOOL_MARKER_LABELS: Readonly<Record<string, string>> = {
  schedulewakeup: "Scheduled a wake-up",
  toolsearch: "Searched for tools",
  enterplanmode: "Entered plan mode",
  exitplanmode: "Exited plan mode",
  pushnotification: "Sent a notification",
};

/** Placeholder for a run that produced no content at all. */
export const EMPTY_RUN_PLACEHOLDER =
  "Assistant ended the turn without a message.";

/** The marker phrase for a hidden tool call. */
function markerLabel(toolName: string): string {
  return HIDDEN_TOOL_MARKER_LABELS[toolName.toLowerCase()] ?? `Ran ${toolName}`;
}

/** True when a tool routes to `NullToolBlock` (zero-ink `hidden` policy). */
function isHiddenTool(toolName: string): boolean {
  return resolveToolBlock(toolName) === NullToolBlock;
}

export type RunBodyFallback = "none" | "plumbing" | "empty";

export interface RunBodyClassification {
  fallback: RunBodyFallback;
  /** Marker phrases for the `plumbing` case, in run order, deduped. Empty otherwise. */
  markers: ReadonlyArray<string>;
}

/**
 * Classify an assistant run's message slice. Pure over the tool-visibility
 * policy. Only top-level tool calls are considered — subagent children
 * (`parentToolUseId` set) render inside their parent's wrapper, not as
 * run-level content.
 */
export function classifyRunBody(
  messages: ReadonlyArray<Message>,
): RunBodyClassification {
  let hasText = false;
  let hasThinking = false;
  let hasVisibleTool = false;
  const markers: string[] = [];

  for (const message of messages) {
    switch (message.kind) {
      case "assistant_text":
        if (message.text.trim() !== "") hasText = true;
        break;
      case "assistant_thinking":
        if (message.text.trim() !== "") hasThinking = true;
        break;
      case "tool_use":
        // Subagent children render inside their parent's AgentTranscriptBlock.
        if (message.parentToolUseId !== undefined) break;
        if (isHiddenTool(message.toolName)) {
          const label = markerLabel(message.toolName);
          if (!markers.includes(label)) markers.push(label);
        } else {
          hasVisibleTool = true;
        }
        break;
      default:
        // user_message / system_note are rendered elsewhere.
        break;
    }
  }

  if (hasText || hasVisibleTool) return { fallback: "none", markers: [] };
  if (markers.length > 0) return { fallback: "plumbing", markers };
  if (hasThinking) return { fallback: "none", markers: [] };
  return { fallback: "empty", markers: [] };
}
