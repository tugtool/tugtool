/**
 * gallery-skill-tool-block.tsx — visual fixture for `SkillToolBlock`.
 *
 * Five sections cover the wrapper's render branches:
 *
 *  1. Short args + short result — the dominant case. Header reads
 *     `Skill · /commit`, body is a single `<code>` row of args plus
 *     a one-line `result` label.
 *  2. Long args — exceeds `INLINE_ARGS_MAX_CHARS`, so the args
 *     section switches to an embedded `TugMarkdownBlock` rendering
 *     the args as a fenced code block.
 *  3. No args — the skill takes no arguments. Body shows only the
 *     result label.
 *  4. Streaming — chrome paints the streaming stripe, body is the
 *     shared `StreamingPlaceholder`.
 *  5. Error — chrome paints the error band from `textOutput`; body
 *     still renders the args section as diagnostic context.
 *
 * @module components/tugways/cards/gallery-skill-tool-block
 */

import React from "react";

import { SkillToolBlock } from "./tool-blocks/skill-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHORT_ARGS_SHORT_RESULT: ToolBlockProps = {
  toolUseId: "skill-1",
  toolName: "Skill",
  msgId: "gallery-msg",
  seq: 0,
  input: { skill: "commit", args: "feat(tide): land Step 24.3.2" },
  textOutput: "done",
  isError: false,
  status: "ready",
};

const LONG_ARGS = [
  "Review the following code carefully and identify any cases where",
  "the renderer might re-mount the same row when state updates arrive",
  "during a streaming token boundary. Pay particular attention to the",
  "useSyncExternalStore subscriptions and the rAF-coalesced observer",
  "wiring; flag any path where a re-render could leak into a parent",
  "list virtualizer's height index.",
].join("\n");

const LONG_ARGS_FIXTURE: ToolBlockProps = {
  toolUseId: "skill-2",
  toolName: "Skill",
  msgId: "gallery-msg",
  seq: 1,
  input: { skill: "review", args: LONG_ARGS },
  textOutput: "review queued",
  isError: false,
  status: "ready",
};

const NO_ARGS: ToolBlockProps = {
  toolUseId: "skill-3",
  toolName: "Skill",
  msgId: "gallery-msg",
  seq: 2,
  input: { skill: "status" },
  textOutput: "branch: main · ahead by 2",
  isError: false,
  status: "ready",
};

const STREAMING: ToolBlockProps = {
  toolUseId: "skill-4",
  toolName: "Skill",
  msgId: "gallery-msg",
  seq: 3,
  input: { skill: "commit" },
  status: "streaming",
};

const ERROR: ToolBlockProps = {
  toolUseId: "skill-5",
  toolName: "Skill",
  msgId: "gallery-msg",
  seq: 4,
  input: { skill: "deploy", args: "production --force" },
  textOutput: "Error: deploy skill requires CI to be green; current build failed.",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GallerySkillToolBlock
// ---------------------------------------------------------------------------

export function GallerySkillToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-skill-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Short args + short result — dominant case
        </TugLabel>
        <SkillToolBlock {...SHORT_ARGS_SHORT_RESULT} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Long args (&gt; 80 chars) — embedded TugMarkdownBlock fenced
        </TugLabel>
        <SkillToolBlock {...LONG_ARGS_FIXTURE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">No args — result only</TugLabel>
        <SkillToolBlock {...NO_ARGS} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Streaming — StreamingPlaceholder body
        </TugLabel>
        <SkillToolBlock {...STREAMING} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error — chrome error band; args still rendered as context
        </TugLabel>
        <SkillToolBlock {...ERROR} />
      </div>
    </div>
  );
}
