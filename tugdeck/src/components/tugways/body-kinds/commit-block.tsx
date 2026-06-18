/**
 * commit-block.tsx — the "commit receipt" body kind.
 *
 * A purpose-built body for a `git commit`. It is a body kind in the
 * `BashToolBlock` sense: the wrapper owns the chrome (the lifecycle dot
 * + "Git Commit" name + collapse chevron, matching every other tool block),
 * and this renders the receipt *inside* that frame — the summary set as
 * a title, a branch `TugBadge` + a click-to-copy short-hash
 * `TugCopyBadge`, the signature diffstat bar, and `ToolBlockDisclosure`
 * sections for the message body and an optional per-file breakdown.
 *
 * Routing intent (not yet wired): `BashToolBlock` swaps this in for a
 * `git commit` command the same way it swaps `DiffBlock` in for
 * `git diff` / `git show`, passing `toolName="Git Commit"` to the chrome.
 * The data it needs is parseable from the Bash call alone —
 * `parseGitCommit(command, stdout)` pulls the full message from the
 * `-m` argument and the branch / hash / diffstat from the commit's
 * stdout. A per-file breakdown is an optional enrichment (it needs a
 * `git show --stat`-shaped source) and degrades to the aggregate bar
 * when absent.
 *
 * This module is currently exercised through `gallery-commit-block.tsx`
 * (which mounts it inside a real `ToolBlockChrome`) while the design is
 * tuned; the routing branch lands once the look is settled.
 *
 * Laws:
 *  - [L06] disclosures are `ToolBlockDisclosure` (native `<details>`) —
 *    appearance toggles through the DOM, no React state.
 *  - [L17] every painted value resolves to a `--tug7-*` / `--tug-*`
 *    base token in one hop via the `--tugx-block-*` aliases.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="commit-block"`.
 *  - [L20] reuses the shared `--tugx-block-*` tone-band colors and the
 *    `TugBadge` / `ToolBlockDisclosure` primitives; the only local
 *    geometry is the diffstat bar.
 *
 * @module components/tugways/body-kinds/commit-block
 */

import "./commit-block.css";

import React from "react";
import { GitBranch } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import { TugCopyBadge } from "@/components/tugways/tug-copy-badge";
import { TugLabel } from "@/components/tugways/tug-label";
import { MiddleEllipsisPath } from "@/components/tugways/cards/tool-blocks/middle-ellipsis-path";
import { ToolBlockDisclosure } from "@/components/tugways/cards/tool-blocks/body-bits/tool-block-disclosure";

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

/** A single file's line delta in a commit. `status` mirrors git's
 *  porcelain letters (M / A / D / R). */
export interface CommitFile {
  path: string;
  status: "M" | "A" | "D" | "R";
  added: number;
  removed: number;
}

/** Parsed commit, everything the receipt needs to render. `files` is an
 *  optional enrichment — when absent the receipt shows only the
 *  aggregate diffstat. */
export interface CommitData {
  /** Short hash, e.g. `450d6b28`. */
  hash: string;
  /** Branch the commit landed on, e.g. `main`. */
  branch: string;
  /** First line of the message — the title. */
  summary: string;
  /** Remaining message lines (blank line after the summary dropped). */
  body: readonly string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
  files?: readonly CommitFile[];
}

// ---------------------------------------------------------------------------
// Parser — command + stdout → CommitData
// ---------------------------------------------------------------------------

/** Pull the `-m "…"` message from a `git commit` command string. Handles
 *  single- or double-quoted messages and the `git add … && git commit …`
 *  compound form. Returns the raw message (summary + body) or `null`. */
function extractCommitMessage(command: string): string | null {
  // Match -m / --message followed by a quoted string. Non-greedy body,
  // closing quote must match the opener. Newlines allowed inside.
  const m = command.match(/-m\s+(["'])([\s\S]*?)\1(?:\s|$)/);
  return m ? m[2] : null;
}

/** Split a raw commit message into a summary line and the remaining body
 *  lines (the blank line separating them is dropped). */
function splitMessage(message: string): { summary: string; body: string[] } {
  const lines = message.split("\n");
  const summary = (lines.shift() ?? "").trim();
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }
  return { summary, body: lines };
}

/**
 * Parse a `git commit` Bash call into `CommitData`. `command` is the
 * shell command (for the full message via `-m`); `stdout` is the commit
 * output (for branch / hash / diffstat). Returns `null` when `stdout`
 * carries no recognizable `[branch hash] …` line — the signal that this
 * was not a successful commit.
 *
 * Recognized stdout shape:
 *   [main 450d6b28] Add separating space when accepting a completion
 *    2 files changed, 32 insertions(+), 14 deletions(-)
 */
export function parseGitCommit(
  command: string,
  stdout: string,
): CommitData | null {
  const head = stdout.match(/^\[([^\]\s]+)\s+([0-9a-f]{7,40})\]\s*(.*)$/m);
  if (head === null) return null;
  const branch = head[1]!;
  const hash = head[2]!;
  const stdoutSummary = head[3]!.trim();

  // Prefer the full message from the command (it carries the body);
  // fall back to the summary echoed in stdout when `-m` isn't parseable
  // (e.g. a `-F file` or editor commit).
  const message = extractCommitMessage(command);
  const { summary, body } =
    message !== null
      ? splitMessage(message)
      : { summary: stdoutSummary, body: [] as string[] };

  const stat = stdout.match(
    /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
  );
  const filesChanged = stat ? Number(stat[1]) : 0;
  const insertions = stat && stat[2] ? Number(stat[2]) : 0;
  const deletions = stat && stat[3] ? Number(stat[3]) : 0;

  return {
    hash,
    branch,
    summary: summary || stdoutSummary,
    body,
    filesChanged,
    insertions,
    deletions,
  };
}

// ---------------------------------------------------------------------------
// Diffstat bar
// ---------------------------------------------------------------------------

/** Total cells in the diffstat bar — the GitHub-style proportion strip. */
const STAT_CELLS = 12;

/** Allocate `STAT_CELLS` between additions and deletions in proportion,
 *  guaranteeing at least one cell to any non-zero side so a tiny delta
 *  still shows. Returns `{ add, del }` cell counts. */
function allocateStatCells(
  insertions: number,
  deletions: number,
): { add: number; del: number } {
  const total = insertions + deletions;
  if (total === 0) return { add: 0, del: 0 };
  let add = Math.round((insertions / total) * STAT_CELLS);
  if (insertions > 0 && add === 0) add = 1;
  if (deletions > 0 && add === STAT_CELLS) add = STAT_CELLS - 1;
  if (insertions === 0) add = 0;
  return { add, del: STAT_CELLS - add };
}

function DiffstatBar({
  insertions,
  deletions,
}: {
  insertions: number;
  deletions: number;
}): React.ReactElement {
  const { add, del } = allocateStatCells(insertions, deletions);
  const cells: React.ReactElement[] = [];
  for (let i = 0; i < add; i++) {
    cells.push(
      <span key={`a${i}`} className="tugx-commit-cell tugx-commit-cell--add" />,
    );
  }
  for (let i = 0; i < del; i++) {
    cells.push(
      <span key={`d${i}`} className="tugx-commit-cell tugx-commit-cell--del" />,
    );
  }
  return (
    <span className="tugx-commit-statbar" aria-hidden="true">
      {cells}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CommitBlock
// ---------------------------------------------------------------------------

export interface CommitHeaderTargetProps {
  commit: CommitData;
}

/**
 * The commit's header-line content — the summary message (ellipsizing to
 * one line) with the branch `TugBadge` and click-to-copy hash
 * `TugCopyBadge` pinned to the right. The wrapper hands this to
 * `ToolBlockChrome` as the header `identity`, so it sits on the tool-call
 * header row beside the "Git Commit" name, exactly where a Bash block's
 * command sits.
 */
export function CommitHeaderTarget({
  commit,
}: CommitHeaderTargetProps): React.ReactElement {
  const { summary, branch, hash } = commit;
  return (
    <span className="tugx-commit-header">
      <span className="tugx-commit-header-summary">{summary}</span>
      <span className="tugx-commit-chips">
        <TugBadge
          emphasis="outlined"
          role="inherit"
          size="sm"
          icon={<GitBranch />}
          copyText={branch}
        >
          {branch}
        </TugBadge>
        <TugCopyBadge
          className="tugx-commit-hash-badge"
          emphasis="tinted"
          role="action"
          size="sm"
          value={hash}
        />
      </span>
    </span>
  );
}

export interface CommitBlockProps {
  commit: CommitData;
}

/**
 * The commit receipt body — rendered inside a `ToolBlockChrome` whose
 * header carries the lifecycle dot + "Git Commit" name and the
 * {@link CommitHeaderTarget} (summary + branch / hash badges). The body
 * holds the diffstat bar and the message / file disclosures.
 */
export function CommitBlock({ commit }: CommitBlockProps): React.ReactElement {
  const { body, filesChanged, insertions, deletions, files } = commit;
  const hasBody = body.length > 0;
  const hasFiles = files !== undefined && files.length > 0;

  return (
    <div className="tugx-commit" data-slot="commit-block">
      <div className="tugx-commit-stat">
        <DiffstatBar insertions={insertions} deletions={deletions} />
        <span className="tugx-commit-stat-num tugx-commit-stat-num--add">
          +{insertions}
        </span>
        <span className="tugx-commit-stat-num tugx-commit-stat-num--del">
          −{deletions}
        </span>
        <span className="tugx-commit-stat-files">
          {filesChanged} {filesChanged === 1 ? "file" : "files"}
        </span>
      </div>

      {hasFiles && (
        <ToolBlockDisclosure
          className="tugx-commit-disclosure"
          summary={
            <TugLabel emphasis="proposal" size="2xs">
              {`${files!.length} ${files!.length === 1 ? "file" : "files"} changed`}
            </TugLabel>
          }
        >
          <ul className="tugx-commit-files">
            {files!.map((f) => (
              <li key={f.path} className="tugx-commit-file">
                <span
                  className={`tugx-commit-file-status tugx-commit-file-status--${f.status.toLowerCase()}`}
                  title={f.status}
                >
                  {f.status}
                </span>
                <span className="tugx-commit-file-path">
                  <MiddleEllipsisPath path={f.path} />
                </span>
                <span className="tugx-commit-file-delta">
                  {f.added > 0 && (
                    <span className="tugx-commit-stat-num--add">+{f.added}</span>
                  )}
                  {f.removed > 0 && (
                    <span className="tugx-commit-stat-num--del">−{f.removed}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </ToolBlockDisclosure>
      )}

      {hasBody && (
        <ToolBlockDisclosure
          className="tugx-commit-disclosure"
          summary={
            <TugLabel emphasis="proposal" size="2xs">
              message
            </TugLabel>
          }
        >
          <div className="tugx-commit-body">
            {body.map((line, i) => (
              <div key={i} className="tugx-commit-body-line">
                {line}
              </div>
            ))}
          </div>
        </ToolBlockDisclosure>
      )}
    </div>
  );
}
