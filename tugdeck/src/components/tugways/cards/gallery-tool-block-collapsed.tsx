/**
 * gallery-tool-block-collapsed.tsx — the collapsed tool-block header
 * ([P09]/[#step-10] of roadmap/transcript-improvements).
 *
 * When a tool block mounts collapsed (the [P06] table), the header IS the
 * whole block — it must answer "what did this tool do?" without expanding:
 * tool identity (icon + name), its target (path / pattern / command), a
 * one-line result summary, the lifecycle status, and exactly two
 * affordances — **Copy** and **Expand**, always visible. (Copy yields the
 * tool's command + result via `toolCallToMarkdown`; that wiring lands when
 * this graduates into `ToolCallHeader` at [#step-11] — the buttons here are
 * no-op vetting stand-ins.)
 *
 * The design is the **Quiet Line** (the vetted winner): one calm row per
 * tool, color only from the lifecycle dot, Copy + Expand at the trailing
 * edge. Long detail **wraps** to more rows while the dot, icon, summary,
 * and buttons stay on the first row. The flow is a grid and each row a
 * subgrid, so the result-summary and buttons hold disciplined columns
 * across every row while the detail wraps within its own column.
 *
 * It renders across the full supported tool range, plus a section of real
 * long Bash commands / deep paths pulled verbatim from session JSONL to
 * stress-test wrapping and column alignment.
 *
 * @module components/tugways/cards/gallery-tool-block-collapsed
 */

import "./gallery-tool-block-collapsed.css";

import React from "react";
import { ChevronDown, Copy } from "lucide-react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import {
  TOOL_CALL_PHASE_LABELS,
  toolCallPhaseVisual,
  type ToolCallPhase,
} from "@/lib/code-session-store/tool-call-phase-visual";

import { toolIconFor } from "./tool-blocks/tool-icons";
import { formatCount } from "./tool-blocks/tool-header-meta";

// ---------------------------------------------------------------------------
// Sample model
// ---------------------------------------------------------------------------

/** A tool call's one-line result, kept as data so the row can format it. */
type SummaryModel =
  | { kind: "count"; count: number; noun: string; pluralNoun?: string }
  | { kind: "diff"; added: number; removed: number }
  | { kind: "exit"; code: number }
  | { kind: "text"; text: string };

interface ToolSample {
  /** Display name (also drives the icon, case-insensitively). */
  toolName: string;
  /** The call's primary target. */
  target: string;
  /** How to read the target — a filesystem path, code/pattern, or a plain label. */
  targetKind: "path" | "code" | "label";
  /** One-line result summary; omitted while a call has no result yet. */
  summary?: SummaryModel;
  /** Lifecycle status the dot paints. */
  phase: ToolCallPhase;
}

/** The full supported tool range, with realistic targets + results. */
const SAMPLES: ReadonlyArray<ToolSample> = [
  {
    toolName: "Read",
    target: "tugdeck/src/lib/markdown/dompurify-instance.ts",
    targetKind: "path",
    summary: { kind: "count", count: 110, noun: "line" },
    phase: "success",
  },
  {
    toolName: "Edit",
    target: "tugdeck/src/components/tugways/cards/dev-card-transcript.tsx",
    targetKind: "path",
    summary: { kind: "diff", added: 42, removed: 7 },
    phase: "success",
  },
  {
    toolName: "Write",
    target: "tugdeck/src/lib/markdown/transcript-copy-html.ts",
    targetKind: "path",
    summary: { kind: "count", count: 84, noun: "line" },
    phase: "success",
  },
  {
    toolName: "Bash",
    target: 'grep -rn "toolName" tugdeck/src | head -20',
    targetKind: "code",
    summary: { kind: "exit", code: 0 },
    phase: "success",
  },
  {
    toolName: "Bash",
    target: "cd tugrust && cargo nextest run",
    targetKind: "code",
    summary: { kind: "exit", code: 1 },
    phase: "error",
  },
  {
    toolName: "Grep",
    target: "useSyncExternalStore",
    targetKind: "code",
    summary: { kind: "count", count: 13, noun: "match", pluralNoun: "matches" },
    phase: "success",
  },
  {
    toolName: "Glob",
    target: "tugdeck/src/**/*.test.ts",
    targetKind: "code",
    summary: { kind: "count", count: 7, noun: "file" },
    phase: "success",
  },
  {
    toolName: "Bash",
    target: "bun test src/lib/markdown",
    targetKind: "code",
    phase: "in_flight",
  },
  {
    toolName: "Agent",
    target: "general-purpose",
    targetKind: "label",
    summary: { kind: "text", text: "6 tools used" },
    phase: "success",
  },
  {
    toolName: "AskUserQuestion",
    target: "Which auth method?",
    targetKind: "label",
    summary: { kind: "text", text: "answered" },
    phase: "awaiting",
  },
  {
    toolName: "Skill",
    target: "tugplug:commit",
    targetKind: "label",
    summary: { kind: "text", text: "committed" },
    phase: "success",
  },
  {
    toolName: "WebFetch",
    target: "https://github.com/anthropics/claude-code",
    targetKind: "label",
    summary: { kind: "text", text: "2.3 KB" },
    phase: "success",
  },
  {
    toolName: "WebSearch",
    target: "markdown rendering best practices",
    targetKind: "label",
    summary: { kind: "count", count: 8, noun: "result" },
    phase: "success",
  },
  {
    toolName: "Monitor",
    target: "tugcast :55371",
    targetKind: "label",
    summary: { kind: "text", text: "watching" },
    phase: "in_flight",
  },
  {
    toolName: "Worktree",
    target: "tugdash/transcript-improvements",
    targetKind: "label",
    summary: { kind: "text", text: "created" },
    phase: "success",
  },
  {
    toolName: "TaskMgmt",
    target: "task list",
    targetKind: "label",
    summary: { kind: "count", count: 3, noun: "task" },
    phase: "success",
  },
  {
    toolName: "Cron",
    target: "0 9 * * 1",
    targetKind: "code",
    summary: { kind: "text", text: "scheduled" },
    phase: "success",
  },
  {
    toolName: "NotebookEdit",
    target: "analysis/explore.ipynb",
    targetKind: "path",
    summary: { kind: "diff", added: 12, removed: 3 },
    phase: "success",
  },
  {
    toolName: "RemoteTrigger",
    target: "deploy-staging",
    targetKind: "label",
    summary: { kind: "text", text: "queued" },
    phase: "success",
  },
  {
    toolName: "ShareOnboardingGuide",
    target: "getting-started",
    targetKind: "label",
    summary: { kind: "text", text: "shared" },
    phase: "success",
  },
];

/**
 * Real long tool calls pulled from this project's session JSONL — the
 * cases that don't fit a tidy line. They stress-test wrapping and column
 * discipline. Verbatim from actual Bash / Read / Grep calls.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Last path segment, for the brief target reading; non-paths pass through. */
function briefTarget(sample: ToolSample): string {
  if (sample.targetKind !== "path") return sample.target;
  const parts = sample.target.split("/");
  return parts[parts.length - 1] ?? sample.target;
}

/** Plain text form of a summary. */
function summaryText(summary: SummaryModel): string {
  switch (summary.kind) {
    case "count":
      return formatCount(summary.count, summary.noun, summary.pluralNoun);
    case "diff":
      return `+${summary.added} −${summary.removed}`;
    case "exit":
      return `exit ${summary.code}`;
    case "text":
      return summary.text;
  }
}

const noop = (): void => {};

/**
 * Copy + Expand, always visible. The chevron points DOWN to expand
 * (content opens downward); the expanded state flips it up to collapse.
 */
function CollapsedAffordances({ toolName }: { toolName: string }): React.ReactElement {
  return (
    <span className="cg-collapsed-actions" data-slot="cg-collapsed-actions">
      <TugIconButton
        icon={<Copy size={13} strokeWidth={2.25} />}
        aria-label={`Copy ${toolName} command and result`}
        size="sm"
        onClick={noop}
      />
      <TugIconButton
        icon={<ChevronDown size={14} strokeWidth={2.5} />}
        aria-label={`Expand ${toolName} tool call`}
        size="sm"
        onClick={noop}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Quiet Line
// ---------------------------------------------------------------------------

/**
 * One calm row when content fits — dot, icon, name, detail, summary, and
 * the Copy/Expand buttons centered on it. When the detail is long it WRAPS
 * to more rows while the dot, icon, summary, and buttons stay on the top
 * row (the flow's subgrid columns keep the summary + buttons aligned).
 * Paths show their basename (the meaningful tail); commands show in full
 * and wrap when long. The summary cell renders even when empty so the grid
 * columns stay consistent across rows.
 */
function QuietLine({ sample }: { sample: ToolSample }): React.ReactElement {
  return (
    <div className="cg-quiet" data-phase={sample.phase}>
      <TugProgressIndicator
        variant="pulsing-dot"
        size={12}
        phase={sample.phase}
        phaseVisual={toolCallPhaseVisual}
        aria-label={TOOL_CALL_PHASE_LABELS[sample.phase]}
        className="cg-quiet-dot"
      />
      <span className="cg-quiet-icon" aria-hidden="true">
        {toolIconFor(sample.toolName)}
      </span>
      <span className="cg-quiet-main">
        <span className="cg-quiet-name">{sample.toolName}</span>
        <span className="cg-quiet-detail" title={sample.target}>
          {briefTarget(sample)}
        </span>
      </span>
      <span className="cg-quiet-summary">
        {sample.summary !== undefined ? summaryText(sample.summary) : null}
      </span>
      <CollapsedAffordances toolName={sample.toolName} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export const GalleryToolBlockCollapsed: React.FC = () => {
  return (
    <div className="gallery-tool-block-collapsed">
      <p className="cg-intro">
        The collapsed tool-block header — the Quiet Line. One calm row per
        tool conveying tool + target + result + status, with exactly two
        always-visible affordances: Copy (command + result) and Expand. The
        flow is a column grid so the result and buttons stay aligned across
        every row.
      </p>

      <section className="cg-candidate">
        <TugLabel>Quiet Line — every tool</TugLabel>
        <p className="cg-blurb">
          Color comes only from the lifecycle dot. Paths read as their
          basename; commands read in full. In-flight calls (no result yet)
          keep their column slots empty so alignment holds.
        </p>
        <div className="cg-flow">
          {SAMPLES.map((sample, i) => (
            <QuietLine key={i} sample={sample} />
          ))}
        </div>
      </section>

      <TugSeparator />

      <section className="cg-candidate">
        <TugLabel>Long content, wrapped (real session data)</TugLabel>
        <p className="cg-blurb">
          A long command wraps across rows within the detail column while
          the result and buttons hold their columns; the dot, icon, result,
          and buttons stay on the top row. A deep path keeps to one row via
          its basename.
        </p>
        <div className="cg-flow">
          {LONG_SAMPLES.map((sample, i) => (
            <QuietLine key={i} sample={sample} />
          ))}
        </div>
      </section>
    </div>
  );
};
