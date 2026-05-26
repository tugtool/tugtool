/**
 * gallery-task-mgmt-tool-block.tsx — visual fixture for `TaskMgmtToolBlock`.
 *
 * One section per verb (`list` / `get` / `output` / `stop`) plus a
 * streaming variant and an error variant — seven in total. The verbs
 * exercise the per-name body branches and the `Background Task ·
 * <verb>` header disambiguation ([D100]).
 *
 * @module components/tugways/cards/gallery-task-mgmt-tool-block
 */

import React from "react";

import { TaskMgmtToolBlock } from "./tool-blocks/task-mgmt-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LIST: ToolBlockProps = {
  toolUseId: "taskmgmt-1",
  toolName: "TaskList",
  seq: 0,
  input: {},
  textOutput: [
    "1  pending      Bundle audit-fixture",
    "2  in_progress  Migrate vendored CSS",
    "3  pending      Wire dispatch routing",
    "4  completed    Backfill snapshot tests",
    "5  pending      Refresh capabilities baseline",
  ].join("\n"),
  isError: false,
  status: "ready",
};

const GET: ToolBlockProps = {
  toolUseId: "taskmgmt-2",
  toolName: "TaskGet",
  seq: 1,
  input: { taskId: "abc123" },
  textOutput:
    "in_progress — Migrate vendored CSS\nBlocked by: refactor of token aliasing",
  isError: false,
  status: "ready",
};

const OUTPUT_SHORT: ToolBlockProps = {
  toolUseId: "taskmgmt-3",
  toolName: "TaskOutput",
  seq: 2,
  input: { task_id: "shell-7", block: true, timeout: 30000 },
  textOutput: "compiling tugcast v0.42.1\nrunning 28 tests\nall tests passed",
  isError: false,
  status: "ready",
};

const OUTPUT_LONG: ToolBlockProps = {
  toolUseId: "taskmgmt-4",
  toolName: "TaskOutput",
  seq: 3,
  input: { task_id: "shell-8", block: false, timeout: 5000 },
  textOutput: [
    "Compiling tugcast v0.42.1 (target/debug)",
    "Compiling tugutil v0.42.1 (target/debug)",
    "Compiling tugbank v0.42.1 (target/debug)",
    "Finished `debug` profile [unoptimized + debuginfo]",
    "Running unittests src/lib.rs (target/debug/deps/tugcast-…)",
    "running 14 tests",
    "test result: ok. 14 passed; 0 failed",
  ].join("\n"),
  isError: false,
  status: "ready",
};

const STOP: ToolBlockProps = {
  toolUseId: "taskmgmt-5",
  toolName: "TaskStop",
  seq: 4,
  input: { task_id: "shell-7" },
  textOutput: "stopped",
  isError: false,
  status: "ready",
};

const STREAMING: ToolBlockProps = {
  toolUseId: "taskmgmt-6",
  toolName: "TaskOutput",
  seq: 5,
  input: { task_id: "shell-9" },
  status: "streaming",
};

const ERROR: ToolBlockProps = {
  toolUseId: "taskmgmt-7",
  toolName: "TaskGet",
  seq: 6,
  input: { taskId: "missing-id" },
  textOutput: "Error: no task with id 'missing-id'",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryTaskMgmtToolBlock
// ---------------------------------------------------------------------------

export function GalleryTaskMgmtToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-task-mgmt-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          list — `Background Task · list` header, tailed result preview
        </TugLabel>
        <TaskMgmtToolBlock {...LIST} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          get — `#&lt;id&gt;` in header + id row + result preview
        </TugLabel>
        <TaskMgmtToolBlock {...GET} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          output — input rows (id + block + timeout) + tail; short output
        </TugLabel>
        <TaskMgmtToolBlock {...OUTPUT_SHORT} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          output — long output, native &lt;details&gt; earlier-lines expand
        </TugLabel>
        <TaskMgmtToolBlock {...OUTPUT_LONG} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          stop — id row + one-line status
        </TugLabel>
        <TaskMgmtToolBlock {...STOP} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Streaming — StreamingPlaceholder body
        </TugLabel>
        <TaskMgmtToolBlock {...STREAMING} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error — chrome error band; id row still rendered for diagnostic context
        </TugLabel>
        <TaskMgmtToolBlock {...ERROR} />
      </div>
    </div>
  );
}
