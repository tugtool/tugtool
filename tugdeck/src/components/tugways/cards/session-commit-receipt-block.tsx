/**
 * `SessionCommitReceiptBlock` — the bespoke `/commit` command-block renderer
 * ([P08]). A committed `/commit` row lands in the transcript as a shell
 * exchange whose `output` is the server-formatted standard summary (S02); this
 * renderer parses that string and presents it as a commit receipt (subject,
 * sha badge, file/± counts) instead of the generic fenced `ShellExchangeBlock`.
 *
 * Registration is a side effect of importing this module — the matcher claims
 * trimmed commands that are `/commit` or start with `"/commit "`, so the same
 * row renders identically live and after a restore ([D111] shell-ledger
 * replay). Every display fact is parsed from the `output` string only (no
 * side-band data), so the live and restored rows are pixel-identical; a parse
 * miss falls back to the generic block so raw output always renders.
 *
 * @module components/tugways/cards/session-commit-receipt-block
 */

import type React from "react";

import { TugBadge } from "@/components/tugways/tug-badge";
import { TugCopyBadge } from "@/components/tugways/tug-copy-badge";
import { BlockChrome } from "../blocks/block-chrome";
import {
  registerCommandBlock,
  type CommandBlockProps,
} from "./session-command-block-registry";
import { ShellExchangeBlock } from "./shell-exchange-block";
import "./session-commit-receipt-block.css";

/** The display facts parsed from an S02 commit summary. */
export interface ParsedCommitReceipt {
  sha: string;
  subject: string;
  files: number;
  added: number;
  removed: number;
}

// The S02 summary shape (server-formatted, the single source):
//   committed <sha> — <subject>
//   <N> file(s) · +<added> −<removed>
// (`—` is U+2014, `·` U+00B7, `−` U+2212 — matched exactly so a hand-typed
// dash never false-parses.)
const HEAD_RE = /^committed (\S+) — (.*)$/;
const COUNTS_RE = /^(\d+) file\(s\) · \+(\d+) −(\d+)$/;

/**
 * Parse a `/commit` receipt from its `output` string. Returns `null` when the
 * output isn't an S02 summary (an older ad-hoc receipt, or a truncated row) —
 * the caller then renders the generic block.
 */
export function parseCommitReceipt(output: string): ParsedCommitReceipt | null {
  const lines = output.split("\n");
  if (lines.length < 2) return null;
  const head = HEAD_RE.exec(lines[0]);
  const counts = COUNTS_RE.exec(lines[1]);
  if (head === null || counts === null) return null;
  return {
    sha: head[1],
    subject: head[2],
    files: Number.parseInt(counts[1], 10),
    added: Number.parseInt(counts[2], 10),
    removed: Number.parseInt(counts[3], 10),
  };
}

export function SessionCommitReceiptBlock(props: CommandBlockProps): React.ReactElement {
  const parsed = parseCommitReceipt(props.message.output);
  if (parsed === null) {
    // Not an S02 summary — let the generic exchange block render raw output.
    return <ShellExchangeBlock {...props} />;
  }
  const { sha, subject, files, added, removed } = parsed;
  const identity = (
    <span className="commit-receipt-header">
      <span className="commit-receipt-summary">{subject}</span>
      <span className="commit-receipt-chips">
        <TugBadge emphasis="outlined" role="inherit" size="sm">
          {`${files} ${files === 1 ? "file" : "files"}`}
        </TugBadge>
        <TugBadge emphasis="outlined" role="inherit" size="sm">{`+${added}`}</TugBadge>
        <TugBadge emphasis="outlined" role="inherit" size="sm">{`−${removed}`}</TugBadge>
        <TugCopyBadge
          className="commit-receipt-hash-badge"
          emphasis="outlined"
          role="inherit"
          size="sm"
          value={sha}
        />
      </span>
    </span>
  );
  return (
    <BlockChrome
      rootSlot="commit-receipt-block"
      variant="receipt"
      toolName="Commit"
      identity={identity}
      phase="success"
      status="ready"
      copyText={`${sha} ${subject}`}
    >
      {null}
    </BlockChrome>
  );
}

/**
 * The command-block matcher: claims a trimmed command that is exactly
 * `/commit` or carries an argument (`/commit <message>`). The ledger always
 * writes `/commit`; the argument form is defensive.
 */
export function matchesCommitReceipt(command: string): boolean {
  return command === "/commit" || command.startsWith("/commit ");
}

// Registration happens at import time (the side-effect import in
// session-card-transcript.tsx loads it before the first resolve, [P08]).
registerCommandBlock("commit-receipt", matchesCommitReceipt, SessionCommitReceiptBlock);
