/**
 * gallery-worktree-tool-block.tsx — visual fixture for `WorktreeToolBlock`.
 *
 * Six sections cover the verb composition + header-fallback chain
 * + body-row gating:
 *
 *  1. Enter with branch only — `Worktree · enter <branch>`. Body
 *     suppressed (header already carries the only identifier).
 *  2. Enter with branch + path — header reads the branch; body
 *     adds a `path:` row with the worktree path.
 *  3. Exit with branch — `Worktree · exit <branch>`. Mirror of (1).
 *  4. Path-only — no branch, header falls back to the path; body
 *     suppressed.
 *  5. Streaming — chrome paints the streaming stripe, body is the
 *     shared `StreamingPlaceholder`.
 *  6. Error — chrome paints the error band from `textOutput`;
 *     body still renders the path row as diagnostic context.
 *
 * @module components/tugways/cards/gallery-worktree-tool-block
 */

import React from "react";

import { WorktreeToolBlock } from "./tool-blocks/worktree-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTER_BRANCH_ONLY: ToolBlockProps = {
  toolUseId: "wt-1",
  toolName: "EnterWorktree",
  seq: 0,
  input: { branch: "feature/tide-step-24-3-2" },
  textOutput: "",
  isError: false,
  status: "ready",
};

const ENTER_BRANCH_PLUS_PATH: ToolBlockProps = {
  toolUseId: "wt-2",
  toolName: "EnterWorktree",
  seq: 1,
  input: {
    branch: "feature/tide-step-24-3-2",
    path: "/Users/kocienda/wt/tide-step-24-3-2",
  },
  textOutput: "",
  isError: false,
  status: "ready",
};

const EXIT_BRANCH: ToolBlockProps = {
  toolUseId: "wt-3",
  toolName: "ExitWorktree",
  seq: 2,
  input: { branch: "feature/tide-step-24-3-2" },
  textOutput: "",
  isError: false,
  status: "ready",
};

const PATH_ONLY: ToolBlockProps = {
  toolUseId: "wt-4",
  toolName: "EnterWorktree",
  seq: 3,
  input: { path: "/Users/kocienda/wt/main" },
  textOutput: "",
  isError: false,
  status: "ready",
};

const STREAMING: ToolBlockProps = {
  toolUseId: "wt-5",
  toolName: "EnterWorktree",
  seq: 4,
  input: {},
  status: "streaming",
};

const ERROR: ToolBlockProps = {
  toolUseId: "wt-6",
  toolName: "EnterWorktree",
  seq: 5,
  input: {
    branch: "feature/x",
    path: "/Users/kocienda/wt/feature-x",
  },
  textOutput:
    "fatal: '/Users/kocienda/wt/feature-x' already checked out at '/Users/kocienda/wt/other'",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryWorktreeToolBlock
// ---------------------------------------------------------------------------

export function GalleryWorktreeToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-worktree-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Enter with branch only — header carries the identifier; no body row
        </TugLabel>
        <WorktreeToolBlock {...ENTER_BRANCH_ONLY} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Enter with branch + path — body adds the `path:` row
        </TugLabel>
        <WorktreeToolBlock {...ENTER_BRANCH_PLUS_PATH} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Exit with branch — `Worktree · exit &lt;branch&gt;`
        </TugLabel>
        <WorktreeToolBlock {...EXIT_BRANCH} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Path-only — header falls back to path; no body row
        </TugLabel>
        <WorktreeToolBlock {...PATH_ONLY} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Streaming — StreamingPlaceholder body
        </TugLabel>
        <WorktreeToolBlock {...STREAMING} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error — chrome error band; body row still rendered as context
        </TugLabel>
        <WorktreeToolBlock {...ERROR} />
      </div>
    </div>
  );
}
