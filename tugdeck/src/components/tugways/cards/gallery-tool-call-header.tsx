/**
 * gallery-tool-call-header.tsx — BlockHeader showcase.
 *
 * The header's lifecycle dot is the point of the regularization, and
 * three of its five phases — `awaiting`, `error`, `interrupted` — are
 * hard to reproduce in a live transcript on demand. This gallery paints
 * every phase side by side, the dot-only failure reading (only the
 * lifecycle dot is red — the name and result stay neutral), the icon
 * on/off choice, a chip identity (no clipping), and a long multi-line
 * command (no truncation).
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

import { BlockHeader } from "../blocks/block-header";
import { ToolCallMetaProvider } from "../blocks/collapse-context";

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

// Every block is collapsible and the header owns Copy in both states, so
// the showcase rows carry a (no-op) disclosure + copyText — matching how
// the transcript mounts them, and keeping the trailing controls cluster
// (and its separator) populated.
const noop = (): void => {};
const demoControls = {
  disclosure: { collapsed: false, onToggle: noop },
  copyText: "demo copy payload",
};

export const GalleryBlockHeader: React.FC = () => {
  return (
    <div className="gallery-tool-call-header">
      <section className="gallery-tch-section">
        <TugLabel>Lifecycle phases (the leftmost dot)</TugLabel>
        <div className="gallery-tch-stack">
          {PHASES.map((phase) => (
            <BlockHeader {...demoControls}
              key={phase}
              phase={phase}
              toolName="Bash"
              target={<code>{`echo "${TOOL_CALL_PHASE_LABELS[phase]}"`}</code>}
            />
          ))}
        </div>
      </section>

      <TugSeparator />

      <section className="gallery-tch-section">
        <TugLabel>Failure reads from the lifecycle dot — nothing else is red</TugLabel>
        <div className="gallery-tch-stack">
          {/* A failed / canceled call is conveyed by the lifecycle dot alone;
              the name and trailing result stay neutral (an exit code is data,
              not an alarm), and the body keeps its neutral surface. */}
          <BlockHeader {...demoControls}
            phase="error"
            toolName="Bash"
            target={<code>npm run build</code>}
            summary={{ kind: "exit", code: 1 }}
          />
          <BlockHeader {...demoControls}
            phase="interrupted"
            toolName="Bash"
            target={<code>cargo test --workspace</code>}
            summary={{ kind: "text", text: "interrupted" }}
          />
        </div>
      </section>

      <TugSeparator />

      <section className="gallery-tch-section">
        <TugLabel>Chip identity — no clipping (was Image #1)</TugLabel>
        <div className="gallery-tch-stack">
          <BlockHeader {...demoControls}
            phase="success"
            toolName="Read"
            target={
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
        <TugLabel>Result summary — counts, diff-stats (one quiet idiom)</TugLabel>
        <div className="gallery-tch-stack">
          <BlockHeader {...demoControls}
            phase="success"
            toolName="Grep"
            target={<code>useState</code>}
            summary={{ kind: "count", count: 1234, noun: "match", pluralNoun: "matches" }}
          />
          <BlockHeader {...demoControls}
            phase="success"
            toolName="Edit"
            target={
              <TugAtomChip
                type="file"
                label={formatAtomLabel(SAMPLE_PATH, "filename")}
                value={SAMPLE_PATH}
                className="tug-atom-chip"
              />
            }
            summary={{ kind: "diff", added: 42, removed: 7 }}
          />
          <BlockHeader {...demoControls}
            phase="success"
            toolName="Glob"
            target={<code>**/*.ts</code>}
            summary={{ kind: "count", count: 1, noun: "file" }}
          />
        </div>
      </section>

      <TugSeparator />

      <section className="gallery-tch-section">
        <TugLabel>Timing — its own pipe section, right of the summary</TugLabel>
        <div className="gallery-tch-stack">
          {/* The timing sits in a separate pipe-delimited section, so a
              summary and a duration read side by side: `summary │ duration`.
              A live in-flight clock needs a `pending` meta with a start in
              the past; a landed block freezes to `toolWallMs`. */}
          <ToolCallMetaProvider
            toolUseId="gallery-write-live"
            toolName="Write"
            status="pending"
            startedAtMs={Date.now() - 20_000}
            toolWallMs={null}
          >
            <BlockHeader {...demoControls}
              phase="in_flight"
              toolName="Write"
              target={<code>tugdeck/src/lib/markdown/enhance-img.ts</code>}
              summary={{ kind: "text", text: "128 lines" }}
            />
          </ToolCallMetaProvider>
          <ToolCallMetaProvider
            toolUseId="gallery-edit-done"
            toolName="Edit"
            status="done"
            startedAtMs={0}
            toolWallMs={640}
          >
            <BlockHeader {...demoControls}
              phase="success"
              toolName="Edit"
              target={
                <TugAtomChip
                  type="file"
                  label={formatAtomLabel(SAMPLE_PATH, "filename")}
                  value={SAMPLE_PATH}
                  className="tug-atom-chip"
                />
              }
              summary={{ kind: "diff", added: 42, removed: 7 }}
            />
          </ToolCallMetaProvider>
        </div>
      </section>

      <TugSeparator />

      <section className="gallery-tch-section">
        <TugLabel>Long command — full, multi-line, no ellipsis</TugLabel>
        <div className="gallery-tch-stack">
          <BlockHeader {...demoControls}
            phase="awaiting"
            toolName="Bash"
            target={<code>{LONG_COMMAND}</code>}
          />
        </div>
      </section>
    </div>
  );
};
