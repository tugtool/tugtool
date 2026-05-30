/**
 * gallery-tool-call-header.tsx — ToolCallHeader showcase.
 *
 * The header's lifecycle dot is the point of the regularization, and
 * three of its five phases — `awaiting`, `error`, `interrupted` — are
 * hard to reproduce in a live transcript on demand. This gallery paints
 * every phase side by side, plus the icon on/off choice, a chip
 * identity (no clipping), and a long multi-line command (no
 * truncation).
 *
 * @module components/tugways/cards/gallery-tool-call-header
 */

import "./gallery-tool-call-header.css";

import React from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugAtomChip } from "@/lib/tug-atom-chip";
import { formatAtomLabel } from "@/lib/tug-atom-img";
import {
  TOOL_CALL_PHASE_LABELS,
  type ToolCallPhase,
} from "@/lib/code-session-store/tool-call-phase-visual";

import { ToolCallHeader } from "./tool-blocks/tool-call-header";
import {
  ToolHeaderCount,
  ToolHeaderDiffStat,
  ToolHeaderTruncated,
} from "./tool-blocks/tool-header-meta";

const PHASES: ReadonlyArray<ToolCallPhase> = [
  "idle",
  "in_flight",
  "awaiting",
  "success",
  "error",
  "interrupted",
];

const LONG_COMMAND =
  'cd /Users/kocienda/Mounts/u/src/tugtool && echo "===== enhance-img: what URL schemes it accepts =====" && ' +
  'grep -n "http\\|data:\\|file:\\|src\\|blob:" tugdeck/src/lib/markdown/enhance-img.ts | head -20';

const SAMPLE_PATH = "tugdeck/src/lib/markdown/dompurify-instance.ts";

export const GalleryToolCallHeader: React.FC = () => {
  return (
    <div className="gallery-tool-call-header">
      <section className="gallery-tch-section">
        <TugLabel>Lifecycle phases (the leftmost dot)</TugLabel>
        <div className="gallery-tch-stack">
          {PHASES.map((phase) => (
            <ToolCallHeader
              key={phase}
              phase={phase}
              toolName="Bash"
              command={<code>{`echo "${TOOL_CALL_PHASE_LABELS[phase]}"`}</code>}
            />
          ))}
        </div>
      </section>

      <TugSeparator />

      <section className="gallery-tch-section">
        <TugLabel>Icon on / off (dot is always leftmost)</TugLabel>
        <div className="gallery-tch-stack">
          <ToolCallHeader
            phase="in_flight"
            toolName="Read"
            showIcon
            identity={
              <TugAtomChip
                type="file"
                label={formatAtomLabel(SAMPLE_PATH, "filename")}
                value={SAMPLE_PATH}
                className="tug-atom-chip"
              />
            }
          />
          <ToolCallHeader
            phase="in_flight"
            toolName="Read"
            showIcon={false}
            identity={
              <TugAtomChip
                type="file"
                label={formatAtomLabel(SAMPLE_PATH, "filename")}
                value={SAMPLE_PATH}
                className="tug-atom-chip"
              />
            }
          />
        </div>
      </section>

      <TugSeparator />

      <section className="gallery-tch-section">
        <TugLabel>Chip identity — no clipping (was Image #1)</TugLabel>
        <div className="gallery-tch-stack">
          <ToolCallHeader
            phase="success"
            toolName="Read"
            identity={
              <TugAtomChip
                type="file"
                label={formatAtomLabel(SAMPLE_PATH, "filename")}
                value={SAMPLE_PATH}
                className="tug-atom-chip"
              />
            }
          />
        </div>
      </section>

      <TugSeparator />

      <section className="gallery-tch-section">
        <TugLabel>Meta cluster — counts, diff-stats, truncated (one idiom)</TugLabel>
        <div className="gallery-tch-stack">
          <ToolCallHeader
            phase="success"
            toolName="Grep"
            identity={<code>useState</code>}
            meta={
              <>
                <ToolHeaderCount count={1234} noun="match" pluralNoun="matches" />
                <ToolHeaderTruncated at={500} />
              </>
            }
          />
          <ToolCallHeader
            phase="success"
            toolName="Edit"
            identity={
              <TugAtomChip
                type="file"
                label={formatAtomLabel(SAMPLE_PATH, "filename")}
                value={SAMPLE_PATH}
                className="tug-atom-chip"
              />
            }
            meta={<ToolHeaderDiffStat added={42} removed={7} />}
          />
          <ToolCallHeader
            phase="success"
            toolName="Glob"
            identity={<code>**/*.ts</code>}
            meta={<ToolHeaderCount count={1} noun="file" />}
          />
        </div>
      </section>

      <TugSeparator />

      <section className="gallery-tch-section">
        <TugLabel>Long command — full, multi-line, no ellipsis</TugLabel>
        <div className="gallery-tch-stack">
          <ToolCallHeader
            phase="awaiting"
            toolName="Bash"
            command={<code>{LONG_COMMAND}</code>}
          />
        </div>
      </section>
    </div>
  );
};
