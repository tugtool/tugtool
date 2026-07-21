/**
 * `SessionCommitReceiptBlock` — the bespoke `/commit` command-block renderer
 * ([P08]). A committed `/commit` row lands in the transcript as a shell
 * exchange whose `output` is the server-formatted standard summary (S02); this
 * renderer parses that string and presents it as a commit receipt (up to three
 * message lines, sha badge, file + one combined ± count badge) instead of the
 * generic fenced `ShellExchangeBlock`.
 *
 * Registration is a side effect of importing this module — the matcher claims
 * trimmed commands that are `/commit` or start with `"/commit "`, so the same
 * row renders identically live and after a restore ([D111] shell-ledger
 * replay). Every display fact is parsed from the exchange row itself — the
 * `output` string plus the ledger-persisted `cwd` (the repo dir the commit
 * diff fetch resolves against) — so the live and restored rows are
 * pixel-identical; a parse miss falls back to the generic block so raw output
 * always renders.
 *
 * @module components/tugways/cards/session-commit-receipt-block
 */

import type React from "react";

import { TugBadge } from "@/components/tugways/tug-badge";
import { TugCopyBadge } from "@/components/tugways/tug-copy-badge";
import { CommitChangesList } from "@/components/tugways/tug-changes-list";
import { BlockChrome } from "../blocks/block-chrome";
import {
  registerCommandBlock,
  type CommandBlockProps,
} from "./session-command-block-registry";
import { ShellExchangeBlock } from "./shell-exchange-block";
import "./session-commit-receipt-block.css";

/** One committed file, frozen into the durable record for the expandable list. */
export interface CommitReceiptFile {
  path: string;
  /** `modified` | `created` | `deleted` | `renamed` (git name-status word). */
  status: string;
  added: number;
  removed: number;
}

/** The display facts parsed from an S02 commit summary. */
export interface ParsedCommitReceipt {
  sha: string;
  /** The full commit message (subject + body); the receipt clamps it to 3 lines. */
  message: string;
  fileCount: number;
  added: number;
  removed: number;
  /** The committed files (from the `files:` line); empty for a legacy record. */
  files: CommitReceiptFile[];
}

// The S02 summary shape (server-formatted, the single source): a fixed machine
// header on line 0, an optional `files:` JSON line, then the verbatim commit
// message.
//   committed <sha> · <N> file(s) · +<added> −<removed>
//   files: [{"path":"…","status":"modified","added":16,"removed":1}, …]
//   <full message>
// (`·` is U+00B7, `−` U+2212 — matched exactly so a hand-typed dash never
// false-parses.)
const HEAD_RE = /^committed (\S+) · (\d+) file\(s\) · \+(\d+) −(\d+)$/;
const FILES_PREFIX = "files: ";

function parseFilesLine(line: string): CommitReceiptFile[] {
  try {
    const raw = JSON.parse(line.slice(FILES_PREFIX.length)) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((f): CommitReceiptFile[] => {
      if (typeof f !== "object" || f === null) return [];
      const r = f as Record<string, unknown>;
      if (typeof r.path !== "string") return [];
      return [
        {
          path: r.path,
          status: typeof r.status === "string" ? r.status : "modified",
          added: typeof r.added === "number" ? r.added : 0,
          removed: typeof r.removed === "number" ? r.removed : 0,
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Parse a `/commit` receipt from its `output` string. Returns `null` when the
 * output isn't an S02 summary (an older ad-hoc receipt, or a truncated row) —
 * the caller then renders the generic block. A legacy record with no `files:`
 * line parses with an empty {@link ParsedCommitReceipt.files}.
 */
export function parseCommitReceipt(output: string): ParsedCommitReceipt | null {
  const lines = output.split("\n");
  const head = HEAD_RE.exec(lines[0] ?? "");
  if (head === null) return null;
  let messageStart = 1;
  let files: CommitReceiptFile[] = [];
  if (lines[1]?.startsWith(FILES_PREFIX) === true) {
    files = parseFilesLine(lines[1]);
    messageStart = 2;
  }
  return {
    sha: head[1],
    message: lines.slice(messageStart).join("\n"),
    fileCount: Number.parseInt(head[2], 10),
    added: Number.parseInt(head[3], 10),
    removed: Number.parseInt(head[4], 10),
    files,
  };
}

export function SessionCommitReceiptBlock(props: CommandBlockProps): React.ReactElement {
  const parsed = parseCommitReceipt(props.message.output);
  if (parsed === null) {
    // Not an S02 summary — let the generic exchange block render raw output.
    return <ShellExchangeBlock {...props} />;
  }
  const { sha, message, fileCount, added, removed, files } = parsed;
  const identity = (
    <span className="commit-receipt-header">
      <span className="commit-receipt-summary">{message}</span>
      <span className="commit-receipt-chips">
        <TugBadge emphasis="outlined" role="inherit" size="sm">
          {`${fileCount} ${fileCount === 1 ? "file" : "files"}`}
        </TugBadge>
        <TugBadge emphasis="outlined" role="inherit" size="sm">{`+${added} −${removed}`}</TugBadge>
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
      copyText={`${sha} ${message}`.trim()}
    >
      {/* The committed files as sha-backed changes rows ([P08]) — the same
          compact rows as the live list, each expanding into the committed
          hunks (lazy per-row `commit`-flavor fetch). `cwd` is the repo dir
          the `/commit` ran in — persisted in the ledger, so live and
          restored rows resolve the same workspace. */}
      {files.length > 0 ? (
        <CommitChangesList root={props.message.cwd} sha={sha} files={files} />
      ) : null}
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
