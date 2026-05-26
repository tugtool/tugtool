/**
 * gallery-remote-trigger-tool-block.tsx — visual fixture for
 * `RemoteTriggerToolBlock`.
 *
 * One section per action (`list` / `get` / `create` / `update` /
 * `run`) + streaming + error variants. The `create` and `update`
 * sections exercise the JSON-formatted `body:` row; the others
 * keep the body minimal.
 *
 * @module components/tugways/cards/gallery-remote-trigger-tool-block
 */

import React from "react";

import { RemoteTriggerToolBlock } from "./tool-blocks/remote-trigger-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LIST: ToolBlockProps = {
  toolUseId: "rt-1",
  toolName: "RemoteTrigger",
  seq: 0,
  input: { action: "list" },
  textOutput: JSON.stringify(
    {
      triggers: [
        { id: "trg-aaa", name: "Daily standup", schedule: "0 9 * * *" },
        { id: "trg-bbb", name: "Weekly review", schedule: "0 10 * * 1" },
      ],
    },
    null,
    2,
  ),
  isError: false,
  status: "ready",
};

const GET: ToolBlockProps = {
  toolUseId: "rt-2",
  toolName: "RemoteTrigger",
  seq: 1,
  input: { action: "get", trigger_id: "trg-aaa" },
  textOutput: JSON.stringify(
    {
      id: "trg-aaa",
      name: "Daily standup",
      schedule: "0 9 * * *",
      next_run_at: "2026-05-25T09:00:00-04:00",
      url: "https://claude.ai/code/triggers/trg-aaa",
    },
    null,
    2,
  ),
  isError: false,
  status: "ready",
};

const CREATE: ToolBlockProps = {
  toolUseId: "rt-3",
  toolName: "RemoteTrigger",
  seq: 2,
  input: {
    action: "create",
    body: {
      name: "Nightly digest",
      schedule: "57 23 * * *",
      prompt: "Summarize the day's commits.",
    },
  },
  textOutput:
    "{\n  \"id\": \"trg-new42\",\n  \"name\": \"Nightly digest\"\n}\n\nRuns next: tomorrow at 23:57 local — https://claude.ai/code/triggers/trg-new42",
  isError: false,
  status: "ready",
};

const UPDATE: ToolBlockProps = {
  toolUseId: "rt-4",
  toolName: "RemoteTrigger",
  seq: 3,
  input: {
    action: "update",
    trigger_id: "trg-new42",
    body: { schedule: "57 22 * * *" },
  },
  textOutput:
    "{\n  \"id\": \"trg-new42\",\n  \"schedule\": \"57 22 * * *\"\n}\n\nRuns next: tomorrow at 22:57 local — https://claude.ai/code/triggers/trg-new42",
  isError: false,
  status: "ready",
};

const RUN: ToolBlockProps = {
  toolUseId: "rt-5",
  toolName: "RemoteTrigger",
  seq: 4,
  input: { action: "run", trigger_id: "trg-aaa" },
  textOutput: JSON.stringify(
    { ok: true, run_id: "run-9z9z9z", started_at: "2026-05-24T17:42:11Z" },
    null,
    2,
  ),
  isError: false,
  status: "ready",
};

const STREAMING: ToolBlockProps = {
  toolUseId: "rt-6",
  toolName: "RemoteTrigger",
  seq: 5,
  input: { action: "list" },
  status: "streaming",
};

const ERROR: ToolBlockProps = {
  toolUseId: "rt-7",
  toolName: "RemoteTrigger",
  seq: 6,
  input: { action: "get", trigger_id: "trg-missing" },
  textOutput: "Error 404: trigger 'trg-missing' not found",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryRemoteTriggerToolBlock
// ---------------------------------------------------------------------------

export function GalleryRemoteTriggerToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-remote-trigger-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          list — no trigger_id; raw API JSON in body
        </TugLabel>
        <RemoteTriggerToolBlock {...LIST} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          get — `#&lt;trigger_id&gt;` in header + result JSON
        </TugLabel>
        <RemoteTriggerToolBlock {...GET} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          create — body row (JSON pretty-print) + summary tail
        </TugLabel>
        <RemoteTriggerToolBlock {...CREATE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          update — trigger_id + partial body + summary tail
        </TugLabel>
        <RemoteTriggerToolBlock {...UPDATE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          run — `#&lt;trigger_id&gt;` in header + acknowledgement JSON
        </TugLabel>
        <RemoteTriggerToolBlock {...RUN} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Streaming — StreamingPlaceholder body
        </TugLabel>
        <RemoteTriggerToolBlock {...STREAMING} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error — chrome error band; action + trigger_id still rendered
        </TugLabel>
        <RemoteTriggerToolBlock {...ERROR} />
      </div>
    </div>
  );
}
