/**
 * gallery-task-inline-tool-block.tsx — visual fixture for
 * `TaskInlineToolBlock`.
 *
 * The wrapper intentionally renders no `ToolBlockChrome` — every
 * fixture below is a single inline-flow row (icon + calm label),
 * laid out as the transcript would render them in sequence. The
 * sections walk through each per-event branch the wrapper supports
 * plus the streaming + error variants.
 *
 * No `session` is passed to the wrapper here (the gallery is a
 * standalone surface). For `TaskUpdate` rows, the wrapper falls
 * back to the `Task #<id>` rendering when no session-derived task
 * list is available — exercised by the dedicated "unknown taskId
 * fallback" section.
 *
 * @module components/tugways/cards/gallery-task-inline-tool-block
 */

import React from "react";

import { TaskInlineToolBlock } from "./tool-blocks/task-inline-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures — each row is a `ToolBlockProps` matching what the
// dispatch would build from a real `ToolCallState`.
// ---------------------------------------------------------------------------

const CREATED: ToolBlockProps = {
  toolUseId: "tcr-1",
  toolName: "TaskCreate",
  seq: 0,
  input: { subject: "Write the spec" },
  isError: false,
  status: "ready",
};

// TaskUpdate fixtures: the gallery doesn't supply a session, so the
// wrapper's subject lookup falls back to `Task #<id>`. That's the
// realistic "no shared task list available" reading.
const STARTED: ToolBlockProps = {
  toolUseId: "tup-1",
  toolName: "TaskUpdate",
  seq: 1,
  input: { taskId: "2", status: "in_progress" },
  isError: false,
  status: "ready",
};

const COMPLETED: ToolBlockProps = {
  toolUseId: "tup-2",
  toolName: "TaskUpdate",
  seq: 2,
  input: { taskId: "2", status: "completed" },
  isError: false,
  status: "ready",
};

const RESET: ToolBlockProps = {
  toolUseId: "tup-3",
  toolName: "TaskUpdate",
  seq: 3,
  input: { taskId: "2", status: "pending" },
  isError: false,
  status: "ready",
};

const UNKNOWN_ID_FALLBACK: ToolBlockProps = {
  toolUseId: "tup-4",
  toolName: "TaskUpdate",
  seq: 4,
  input: { taskId: "99", status: "completed" },
  isError: false,
  status: "ready",
};

const STREAMING_CREATE: ToolBlockProps = {
  toolUseId: "tcr-stream",
  toolName: "TaskCreate",
  seq: 5,
  input: {},
  status: "streaming",
};

const STREAMING_UPDATE: ToolBlockProps = {
  toolUseId: "tup-stream",
  toolName: "TaskUpdate",
  seq: 6,
  input: { taskId: "2" }, // status not yet arrived
  status: "streaming",
};

const ERROR_CREATE: ToolBlockProps = {
  toolUseId: "tcr-err",
  toolName: "TaskCreate",
  seq: 7,
  input: { subject: "Write the spec" },
  textOutput: "Error: subject is required",
  isError: true,
  status: "error",
};

const ERROR_UPDATE: ToolBlockProps = {
  toolUseId: "tup-err",
  toolName: "TaskUpdate",
  seq: 8,
  input: { taskId: "99", status: "completed" },
  textOutput: "Error: no task with id '99'",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryTaskInlineToolBlock
// ---------------------------------------------------------------------------

export function GalleryTaskInlineToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-task-inline-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          TaskCreate — `Created: &lt;subject&gt;`
        </TugLabel>
        <TaskInlineToolBlock {...CREATED} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          TaskUpdate → in_progress — `Started: …`
        </TugLabel>
        <TaskInlineToolBlock {...STARTED} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          TaskUpdate → completed — `Completed: …`
        </TugLabel>
        <TaskInlineToolBlock {...COMPLETED} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          TaskUpdate → pending — `Reset: …` (rare revert)
        </TugLabel>
        <TaskInlineToolBlock {...RESET} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          TaskUpdate with unknown taskId — `Task #&lt;id&gt;` fallback
        </TugLabel>
        <TaskInlineToolBlock {...UNKNOWN_ID_FALLBACK} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Streaming TaskCreate — `Creating…` placeholder
        </TugLabel>
        <TaskInlineToolBlock {...STREAMING_CREATE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Streaming TaskUpdate — `Updating…` placeholder
        </TugLabel>
        <TaskInlineToolBlock {...STREAMING_UPDATE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error on TaskCreate — danger tone, calm dropped
        </TugLabel>
        <TaskInlineToolBlock {...ERROR_CREATE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error on TaskUpdate — danger tone, calm dropped
        </TugLabel>
        <TaskInlineToolBlock {...ERROR_UPDATE} />
      </div>
    </div>
  );
}
