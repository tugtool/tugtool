/**
 * gallery-cron-tool-block.tsx — visual fixture for `CronToolBlock`.
 *
 * One section per verb (`create` / `delete` / `list`) + streaming +
 * error variants. The verbs exercise the per-name body branches and
 * the `Cron · <verb>` header pattern.
 *
 * @module components/tugways/cards/gallery-cron-tool-block
 */

import React from "react";

import { CronToolBlock } from "./tool-blocks/cron-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CREATE: ToolBlockProps = {
  toolUseId: "cron-1",
  toolName: "CronCreate",
  msgId: "gallery-msg",
  seq: 0,
  input: {
    cron: "57 8 * * *",
    prompt: "Send me the daily standup summary",
    recurring: true,
    durable: false,
  },
  textOutput: "Created cron job cron-abc123 (next fire: tomorrow 08:57 local)",
  isError: false,
  status: "ready",
};

const DELETE: ToolBlockProps = {
  toolUseId: "cron-2",
  toolName: "CronDelete",
  msgId: "gallery-msg",
  seq: 1,
  input: { id: "cron-abc123" },
  textOutput: "Deleted",
  isError: false,
  status: "ready",
};

const LIST: ToolBlockProps = {
  toolUseId: "cron-3",
  toolName: "CronList",
  msgId: "gallery-msg",
  seq: 2,
  input: {},
  textOutput: [
    "cron-abc123  57 8 * * *      Send me the daily standup summary",
    "cron-def456  7 * * * *       Hourly pulse check",
    "cron-ghi789  3 9 * * 1-5     Weekday morning brief",
  ].join("\n"),
  isError: false,
  status: "ready",
};

const STREAMING: ToolBlockProps = {
  toolUseId: "cron-4",
  toolName: "CronCreate",
  msgId: "gallery-msg",
  seq: 3,
  input: { cron: "0 9" },
  status: "streaming",
};

const ERROR: ToolBlockProps = {
  toolUseId: "cron-5",
  toolName: "CronDelete",
  msgId: "gallery-msg",
  seq: 4,
  input: { id: "cron-missing" },
  textOutput: "Error: no cron job with id 'cron-missing'",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryCronToolBlock
// ---------------------------------------------------------------------------

export function GalleryCronToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-cron-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          create — cron expression + prompt + flags + result
        </TugLabel>
        <CronToolBlock {...CREATE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          delete — `#&lt;id&gt;` in header + id row + status
        </TugLabel>
        <CronToolBlock {...DELETE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          list — no args; body shows the job list
        </TugLabel>
        <CronToolBlock {...LIST} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Streaming — StreamingPlaceholder body
        </TugLabel>
        <CronToolBlock {...STREAMING} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error — chrome error band; id row still rendered
        </TugLabel>
        <CronToolBlock {...ERROR} />
      </div>
    </div>
  );
}
