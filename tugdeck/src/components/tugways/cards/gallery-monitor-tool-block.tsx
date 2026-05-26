/**
 * gallery-monitor-tool-block.tsx — visual fixture for `MonitorToolBlock`.
 *
 * Six sections cover the header-fallback chain and the body's
 * tail/expand branches:
 *
 *  1. Command + until + short output — the dominant case. Header
 *     reads `Monitor · tail -F app.log`, body shows the `until`
 *     row and the full output (≤ 3 lines, no `<details>` collapse).
 *  2. Long output — exceeds `TAIL_LINE_COUNT`. Body shows the
 *     native `<details>` `"show N earlier lines"` summary above
 *     the tail.
 *  3. Path-based header — no `command`, falls back to `path`.
 *  4. Pid-based header — no `command` or `path`, falls back to
 *     `pid <N>`.
 *  5. Streaming — chrome paints the streaming stripe, body is the
 *     shared `StreamingPlaceholder`.
 *  6. Error — chrome paints the error band from `textOutput`;
 *     body still renders whatever output it has.
 *
 * @module components/tugways/cards/gallery-monitor-tool-block
 */

import React from "react";

import { MonitorToolBlock } from "./tool-blocks/monitor-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMMAND_SHORT_OUTPUT: ToolBlockProps = {
  toolUseId: "monitor-1",
  toolName: "Monitor",
  seq: 0,
  input: {
    command: "tail -F /var/log/app.log",
    until: "ready",
  },
  textOutput: "starting up\nopened pipe\nlistening on :8080",
  isError: false,
  status: "ready",
};

const LONG_OUTPUT: ToolBlockProps = {
  toolUseId: "monitor-2",
  toolName: "Monitor",
  seq: 1,
  input: {
    command: "journalctl -u app.service -f",
    until: "exit code 0",
  },
  textOutput: [
    "Jan 01 12:00:01 host app[1234]: configured pool size 32",
    "Jan 01 12:00:01 host app[1234]: connecting to db",
    "Jan 01 12:00:02 host app[1234]: db handshake ok",
    "Jan 01 12:00:02 host app[1234]: cache warm",
    "Jan 01 12:00:03 host app[1234]: schema migration complete",
    "Jan 01 12:00:03 host app[1234]: listening on :8080",
    "Jan 01 12:00:03 host app[1234]: ready",
  ].join("\n"),
  isError: false,
  status: "ready",
};

const PATH_HEADER: ToolBlockProps = {
  toolUseId: "monitor-3",
  toolName: "Monitor",
  seq: 2,
  input: { path: "/var/spool/build/status.json" },
  textOutput: '{ "status": "queued" }',
  isError: false,
  status: "ready",
};

const PID_HEADER: ToolBlockProps = {
  toolUseId: "monitor-4",
  toolName: "Monitor",
  seq: 3,
  input: { pid: 12345 },
  textOutput: "process still alive",
  isError: false,
  status: "ready",
};

const STREAMING: ToolBlockProps = {
  toolUseId: "monitor-5",
  toolName: "Monitor",
  seq: 4,
  input: { command: "tail -F" },
  status: "streaming",
};

const ERROR: ToolBlockProps = {
  toolUseId: "monitor-6",
  toolName: "Monitor",
  seq: 5,
  input: { command: "tail -F /missing.log", until: "ready" },
  textOutput: "tail: cannot open '/missing.log' for reading: No such file or directory",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryMonitorToolBlock
// ---------------------------------------------------------------------------

export function GalleryMonitorToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-monitor-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Command + until + short output — dominant case
        </TugLabel>
        <MonitorToolBlock {...COMMAND_SHORT_OUTPUT} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Long output — native &lt;details&gt; expand affordance
        </TugLabel>
        <MonitorToolBlock {...LONG_OUTPUT} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Path-based header — fallback when no command
        </TugLabel>
        <MonitorToolBlock {...PATH_HEADER} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Pid-based header — fallback when no command or path
        </TugLabel>
        <MonitorToolBlock {...PID_HEADER} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Streaming — StreamingPlaceholder body
        </TugLabel>
        <MonitorToolBlock {...STREAMING} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error — chrome error band; until row still rendered
        </TugLabel>
        <MonitorToolBlock {...ERROR} />
      </div>
    </div>
  );
}
