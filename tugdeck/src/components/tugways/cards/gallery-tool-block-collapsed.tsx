/**
 * gallery-tool-block-collapsed.tsx — the collapsed tool-block header
 * ([P09] Quiet Line, [#step-10]/[#step-11]).
 *
 * Renders the REAL production `ToolCallHeader` (collapsed state) across the full
 * supported tool range, plus a section of real long Bash commands / deep
 * paths pulled verbatim from session JSONL to stress-test wrapping and
 * column discipline. Because this card mounts the same component the
 * transcript uses when a tool block is collapsed, the gallery and the
 * live transcript cannot diverge — what you vet here is what ships.
 *
 * Copy / Expand are live affordances on the real component; here Copy
 * writes a representative payload and Expand is a no-op (there is no
 * surrounding chrome to toggle).
 *
 * @module components/tugways/cards/gallery-tool-block-collapsed
 */

import React from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugAtomChip } from "@/lib/tug-atom-chip";
import { formatAtomLabel } from "@/lib/tug-atom-img";
import type { ToolCallPhase } from "@/lib/code-session-store/tool-call-phase-visual";

import { ToolCallHeader } from "./tool-blocks/tool-call-header";
import { formatToolResultSummary, type ToolResultSummary } from "./tool-blocks/tool-result-summary";

import "./gallery-tool-block-collapsed.css";

interface ToolSample {
  toolName: string;
  target: string;
  targetKind: "path" | "code" | "label";
  summary?: ToolResultSummary;
  phase: ToolCallPhase;
}

/** The full supported tool range, with realistic targets + results. */
const SAMPLES: ReadonlyArray<ToolSample> = [
  { toolName: "Read", target: "tugdeck/src/lib/markdown/dompurify-instance.ts", targetKind: "path", summary: { kind: "count", count: 110, noun: "line" }, phase: "success" },
  { toolName: "Edit", target: "tugdeck/src/components/tugways/cards/dev-card-transcript.tsx", targetKind: "path", summary: { kind: "diff", added: 42, removed: 7 }, phase: "success" },
  { toolName: "Write", target: "tugdeck/src/lib/markdown/transcript-copy-html.ts", targetKind: "path", summary: { kind: "text", text: "84 lines" }, phase: "success" },
  { toolName: "Bash", target: 'grep -rn "toolName" tugdeck/src | head -20', targetKind: "code", summary: { kind: "exit", code: 0 }, phase: "success" },
  { toolName: "Bash", target: "cd tugrust && cargo nextest run", targetKind: "code", summary: { kind: "exit", code: 1 }, phase: "error" },
  { toolName: "Grep", target: "useSyncExternalStore", targetKind: "code", summary: { kind: "count", count: 13, noun: "match", pluralNoun: "matches" }, phase: "success" },
  { toolName: "Glob", target: "tugdeck/src/**/*.test.ts", targetKind: "code", summary: { kind: "count", count: 7, noun: "file" }, phase: "success" },
  { toolName: "Bash", target: "bun test src/lib/markdown", targetKind: "code", phase: "in_flight" },
  { toolName: "Agent", target: "general-purpose", targetKind: "label", summary: { kind: "text", text: "6 tools used" }, phase: "success" },
  { toolName: "AskUserQuestion", target: "Which auth method?", targetKind: "label", summary: { kind: "text", text: "answered" }, phase: "awaiting" },
  { toolName: "Skill", target: "tugplug:commit", targetKind: "label", summary: { kind: "text", text: "committed" }, phase: "success" },
  { toolName: "WebFetch", target: "https://github.com/anthropics/claude-code", targetKind: "label", summary: { kind: "text", text: "2.3 KB" }, phase: "success" },
  { toolName: "WebSearch", target: "markdown rendering best practices", targetKind: "label", summary: { kind: "count", count: 8, noun: "result" }, phase: "success" },
  { toolName: "Monitor", target: "tugcast :55371", targetKind: "label", summary: { kind: "text", text: "watching" }, phase: "in_flight" },
  { toolName: "Worktree", target: "tugdash/transcript-improvements", targetKind: "label", summary: { kind: "text", text: "created" }, phase: "success" },
  { toolName: "TaskMgmt", target: "task list", targetKind: "label", summary: { kind: "count", count: 3, noun: "task" }, phase: "success" },
  { toolName: "Cron", target: "0 9 * * 1", targetKind: "code", summary: { kind: "text", text: "scheduled" }, phase: "success" },
  { toolName: "NotebookEdit", target: "analysis/explore.ipynb", targetKind: "path", summary: { kind: "diff", added: 12, removed: 3 }, phase: "success" },
  { toolName: "RemoteTrigger", target: "deploy-staging", targetKind: "label", summary: { kind: "text", text: "queued" }, phase: "success" },
  { toolName: "ShareOnboardingGuide", target: "getting-started", targetKind: "label", summary: { kind: "text", text: "shared" }, phase: "success" },
];

/**
 * Real long tool calls pulled from this project's session JSONL — the
 * cases that don't fit a tidy line, verbatim from actual Bash / Read /
 * Grep calls.
 */
const LONG_SAMPLES: ReadonlyArray<ToolSample> = [
  {
    toolName: "Bash",
    target:
      'cd /Users/kocienda/Mounts/u/src/tugtool && echo "===== enhance-img: what URL schemes it accepts =====" && grep -n "http\\|data:\\|file:\\|src\\|blob:" tugdeck/src/lib/markdown/enhance-img.ts | head -20',
    targetKind: "code",
    summary: { kind: "count", count: 20, noun: "line" },
    phase: "success",
  },
  {
    toolName: "Bash",
    target:
      "git -C /Users/kocienda/Mounts/u/src/tugtool add roadmap/tugplan-tide-session-wake.md tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/test-monitor-wake-raw.jsonl tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/README.md",
    targetKind: "code",
    summary: { kind: "exit", code: 0 },
    phase: "success",
  },
  {
    toolName: "Read",
    target:
      "/Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugdash__compact-boundary-divider/tugdeck/src/lib/code-session-store/__tests__/reducer.compact-boundary.test.ts",
    targetKind: "path",
    summary: { kind: "count", count: 248, noun: "line" },
    phase: "success",
  },
  {
    toolName: "Grep",
    target: "step-7-7|Step Status Ledger|step-7-6|#step-cycle",
    targetKind: "code",
    summary: { kind: "count", count: 31, noun: "match", pluralNoun: "matches" },
    phase: "success",
  },
];

const noop = (): void => {};

/** Build the target node the way the real tool wrappers do. */
function targetNode(sample: ToolSample): React.ReactNode {
  if (sample.targetKind === "path") {
    return (
      <TugAtomChip
        type="file"
        label={formatAtomLabel(sample.target, "filename")}
        value={sample.target}
        className="tug-atom-chip"
      />
    );
  }
  if (sample.targetKind === "code") {
    return <code>{sample.target}</code>;
  }
  return sample.target;
}

/** A representative command+result payload for the demo Copy button. */
function sampleCopyText(sample: ToolSample): string {
  const result = sample.summary !== undefined ? formatToolResultSummary(sample.summary) : "";
  return `${sample.toolName}: ${sample.target}${result !== "" ? `\n${result}` : ""}`;
}

function Row({ sample }: { sample: ToolSample }): React.ReactElement {
  return (
    <ToolCallHeader
      phase={sample.phase}
      toolName={sample.toolName}
      target={targetNode(sample)}
      summary={sample.summary}
      copyText={sampleCopyText(sample)}
      disclosure={{ collapsed: true, onToggle: noop }}
    />
  );
}


export const GalleryToolBlockCollapsed: React.FC = () => {
  return (
    <div className="gallery-tool-block-collapsed">
      <p className="cg-intro">
        The collapsed tool-block header — the production{" "}
        <code>ToolCallHeader</code> in its collapsed state, the same component
        the transcript renders for every tool block. One calm row per tool: tool +
        target + result + status, with Copy (command + result) and Expand.
        Color comes only from the lifecycle dot.
      </p>

      <section className="cg-candidate">
        <TugLabel>Every tool</TugLabel>
        <div className="cg-flow">
          {SAMPLES.map((sample, i) => (
            <Row key={i} sample={sample} />
          ))}
        </div>
      </section>

      <TugSeparator />

      <section className="cg-candidate">
        <TugLabel>Long content, wrapped (real session data)</TugLabel>
        <p className="cg-blurb">
          A long command wraps within the detail column while the result and
          buttons keep the top row; a deep path stays one row via its basename.
        </p>
        <div className="cg-flow">
          {LONG_SAMPLES.map((sample, i) => (
            <Row key={i} sample={sample} />
          ))}
        </div>
      </section>
    </div>
  );
};
