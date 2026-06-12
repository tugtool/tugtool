/**
 * gallery-collapsed-history.tsx — visual fixture for history-collapsed
 * tool blocks ([P02] of the resume-performance plan).
 *
 * Replayed tool blocks mount header-only: the lifecycle dot, the
 * disclosure chevron, the tool name, and the per-tool identity /
 * command row ARE the collapsed digest ([Q02]) — no body subtree
 * exists until the user expands. This card mounts the collapse
 * mechanism across representative tool families so the collapsed
 * reading can be judged per family:
 *
 *  1. Bash (terminal body) — collapsed; the command row is the digest.
 *  2. Bash (diff-shaped output) — pre-expanded via a primed expansion
 *     override, showing the expanded state with the chevron rotated
 *     and the DiffBlock body mounted.
 *  3. Read — collapsed; the path identity is the digest.
 *  4. Unknown tool (DefaultToolBlock / JsonTree body) — collapsed,
 *     with a caution badge, proving chrome extras stay legible
 *     header-only.
 *  5. Bash error — collapsed; the error stripe + dot communicate the
 *     failure without the body.
 *
 * The card provides a real `ToolBlockExpansionState` through
 * `ToolBlockExpansionContext` so toggles exercise the exact
 * sparse-override write path the transcript uses (minus [A9]
 * persistence, which the transcript host owns).
 *
 * @module components/tugways/cards/gallery-collapsed-history
 */

import React from "react";

import { BashToolBlock } from "./tool-blocks/bash-tool-block";
import { DefaultToolBlock } from "./tool-blocks/default-tool-block";
import { ReadToolBlock } from "./tool-blocks/read-tool-block";
import {
  ToolBlockExpansionContext,
  ToolBlockHistoryCollapse,
} from "./tool-blocks/collapse-context";
import { ToolBlockExpansionState } from "./tool-blocks/expansion-state";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

const BASH_TERMINAL: ToolBlockProps = {
  toolUseId: "hist-bash-1",
  toolName: "Bash",
  seq: 0,
  input: { command: "cargo nextest run --workspace" },
  structuredResult: {
    stdout: Array.from(
      { length: 60 },
      (_, i) => `    PASS [ 0.${String(i).padStart(2, "0")}s] crate::test_${i}`,
    ).join("\n"),
    stderr: "",
    interrupted: false,
  },
  isError: false,
  status: "ready",
  durationMs: 4200,
};

const BASH_DIFF: ToolBlockProps = {
  toolUseId: "hist-bash-2",
  toolName: "Bash",
  seq: 1,
  input: { command: "git diff src/greet.ts" },
  structuredResult: {
    stdout: `diff --git a/src/greet.ts b/src/greet.ts
index abc1234..def5678 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,3 @@
 export function greet(name: string) {
-  return "Hello " + name;
+  return \`Hello, \${name}!\`;
 }
`,
    stderr: "",
    interrupted: false,
  },
  isError: false,
  status: "ready",
  durationMs: 90,
};

const READ_FILE: ToolBlockProps = {
  toolUseId: "hist-read-1",
  toolName: "Read",
  seq: 2,
  input: { file_path: "/u/src/tugtool/tugdeck/src/main.tsx" },
  textOutput: Array.from(
    { length: 40 },
    (_, i) => `${i + 1}\timport line ${i + 1};`,
  ).join("\n"),
  isError: false,
  status: "ready",
  durationMs: 8,
};

const UNKNOWN_TOOL: ToolBlockProps = {
  toolUseId: "hist-unknown-1",
  toolName: "FrobnicateWidget",
  seq: 3,
  input: { target: "widget-7", mode: "full", flags: ["a", "b"] },
  textOutput: '{"frobnicated": true, "widgets": 7}',
  isError: false,
  status: "ready",
  caution: { reason: "unknown_tool" },
};

const BASH_ERROR: ToolBlockProps = {
  toolUseId: "hist-bash-err-1",
  toolName: "Bash",
  seq: 4,
  input: { command: "bun run build" },
  textOutput: "error: Script not found \"build\"",
  isError: true,
  status: "error",
  durationMs: 130,
};

interface RowProps {
  label: string;
  toolUseId: string;
  children: React.ReactNode;
}

const Row: React.FC<RowProps> = ({ label, toolUseId, children }) => (
  <>
    <TugLabel>{label}</TugLabel>
    <ToolBlockHistoryCollapse toolUseId={toolUseId}>
      {children}
    </ToolBlockHistoryCollapse>
    <TugSeparator />
  </>
);

export function GalleryCollapsedHistory(): React.ReactElement {
  // One expansion state per card mount, primed so the diff-bash block
  // demonstrates the EXPANDED reading from first paint.
  const [expansion] = React.useState(() => {
    const state = new ToolBlockExpansionState();
    state.set(BASH_DIFF.toolUseId, false, true);
    return state;
  });
  return (
    <div className="cg-content" data-testid="gallery-collapsed-history">
      <ToolBlockExpansionContext.Provider value={expansion}>
        <Row label="Bash — collapsed (command row is the digest)" toolUseId={BASH_TERMINAL.toolUseId}>
          <BashToolBlock {...BASH_TERMINAL} />
        </Row>
        <Row label="Bash — pre-expanded (diff body mounted)" toolUseId={BASH_DIFF.toolUseId}>
          <BashToolBlock {...BASH_DIFF} />
        </Row>
        <Row label="Read — collapsed (path is the digest)" toolUseId={READ_FILE.toolUseId}>
          <ReadToolBlock {...READ_FILE} />
        </Row>
        <Row label="Unknown tool — collapsed with caution badge" toolUseId={UNKNOWN_TOOL.toolUseId}>
          <DefaultToolBlock {...UNKNOWN_TOOL} />
        </Row>
        <Row label="Bash — error, collapsed (stripe + dot carry it)" toolUseId={BASH_ERROR.toolUseId}>
          <BashToolBlock {...BASH_ERROR} />
        </Row>
      </ToolBlockExpansionContext.Provider>
    </div>
  );
}
