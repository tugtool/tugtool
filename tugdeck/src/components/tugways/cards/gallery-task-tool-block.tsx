/**
 * gallery-task-tool-block.tsx — visual fixture for `TaskToolBlock`.
 *
 * Four sections cover the Agent block's render states (see the
 * `#agent-states` spec in `roadmap/tool-block-renderers.md`):
 *
 *  1. Kicking off — streaming, no nested calls yet. The header shows
 *     the agent type + description and a blue in-flight dot; the body
 *     is `AgentWorkingBody` (calm working content, no count badge yet).
 *  2. Running — streaming with live nested calls. The transcript
 *     renders the nested tool blocks and the header carries an
 *     `N calls` count badge; the dot is still blue.
 *  3. Completed — ready. Green dot, `N calls` badge, the full
 *     transcript (nested calls + final answer), token/duration footer.
 *     No status text — the dot carries lifecycle ([D02]).
 *  4. Error — the chrome paints the error band from `textOutput`; the
 *     dot reads danger.
 *
 * @module components/tugways/cards/gallery-task-tool-block
 */

import React from "react";

import { TaskToolBlock } from "./tool-blocks/task-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const KICKING_OFF: ToolBlockProps = {
  toolUseId: "agent-kickoff",
  toolName: "Agent",
  seq: 0,
  input: {
    subagent_type: "Explore",
    description: "Map the tool-block renderer subsystem",
  },
  status: "streaming",
};

const RUNNING: ToolBlockProps = {
  toolUseId: "agent-running",
  toolName: "Agent",
  seq: 1,
  input: {
    subagent_type: "Explore",
    description: "Find all callers of resolveToolBlock",
  },
  structuredResult: {
    agentType: "Explore",
    status: "in_progress",
    totalToolUseCount: 2,
    content: [
      {
        type: "tool_use",
        id: "tu-bash-running",
        name: "Bash",
        input: { command: "rg -n resolveToolBlock src/" },
      },
      {
        type: "tool_use",
        id: "tu-read-running",
        name: "Read",
        input: {
          file_path: "src/components/tugways/cards/dev-assistant-renderer-dispatch.ts",
        },
      },
    ],
  },
  status: "streaming",
};

const COMPLETED: ToolBlockProps = {
  toolUseId: "agent-completed",
  toolName: "Agent",
  seq: 2,
  input: {
    subagent_type: "Explore",
    description: "Audit status text across tool blocks",
  },
  structuredResult: {
    agentType: "Explore",
    status: "completed",
    totalToolUseCount: 3,
    totalDurationMs: 8200,
    totalTokens: 18400,
    content: [
      {
        type: "tool_use",
        id: "tu-grep-done",
        name: "Grep",
        input: { pattern: "data-agent-status", path: "src" },
      },
      {
        type: "text",
        text:
          "Status text appeared in task-tool-block and three body field rows; " +
          "all now normalized onto the dot + badge mechanism.",
      },
    ],
  },
  status: "ready",
};

const ERROR: ToolBlockProps = {
  toolUseId: "agent-error",
  toolName: "Agent",
  seq: 3,
  input: {
    subagent_type: "Plan",
    description: "Design the migration",
  },
  textOutput: "Error: subagent exceeded its depth budget before returning.",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryTaskToolBlock
// ---------------------------------------------------------------------------

export function GalleryTaskToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-task-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Kicking off — working body, no count yet (blue dot)
        </TugLabel>
        <TaskToolBlock {...KICKING_OFF} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Running — live nested calls + count badge (blue dot)
        </TugLabel>
        <TaskToolBlock {...RUNNING} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Completed — transcript + count badge + footer (green dot, no status text)
        </TugLabel>
        <TaskToolBlock {...COMPLETED} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error — chrome error band (danger dot)
        </TugLabel>
        <TaskToolBlock {...ERROR} />
      </div>
    </div>
  );
}
