/**
 * gallery-commit-receipt.tsx — visual fixture for the `/commit` durable
 * receipt (`SessionCommitReceiptBlock`, [P08]).
 *
 * The design surface the session-commit receipt header is tuned against:
 * a wrapping multi-line subject beside the file / diff / sha chips, so the
 * message baseline vs the "Commit" name and the header's bottom padding are
 * judged by eye (and measured by `at0264`). The fixture drives the REAL
 * `parseCommitReceipt(output)` over an S02 summary string, so it exercises
 * the actual parse + render path, not a hand-built receipt.
 *
 * @module components/tugways/cards/gallery-commit-receipt
 */

import React from "react";

import { SessionCommitReceiptBlock } from "./session-commit-receipt-block";
import type { CommandBlockProps } from "./session-command-block-registry";
import type { ShellExchangeMessage } from "@/lib/code-session-store/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

/** An S02 commit summary with a long subject (wraps to two visual lines) plus
 *  a body + trailer — the header must show ONLY the wrapped subject, never the
 *  body. The shape that surfaced the header baseline + trailing-space bugs. */
const OUTPUT_WRAPPING =
  `committed e5fe894037 · 2 file(s) · +58 −0\n` +
  `files: [{"path":"lincoln-generals.md","status":"created","added":25,"removed":0},` +
  `{"path":"lincoln-speeches.md","status":"created","added":33,"removed":0}]\n` +
  `docs(lincoln-generals): add commanding generals overview\n` +
  `\n` +
  `- add Lincoln's commanding generals hired/fired doc\n` +
  `- add list of Lincoln's 8 most famous speeches\n` +
  `\n` +
  `Tug-Session: Add five battles to civil war battles (1732aa42-a636-4643-99d3-43c781a4d16a)`;

/** A one-line subject — the header stays a single row. */
const OUTPUT_ONE_LINE =
  `committed 8245846f · 1 file(s) · +18 −3\n` +
  `files: [{"path":"smart-scroll.ts","status":"modified","added":18,"removed":3}]\n` +
  `Guard follow-bottom disengage on non-scrollable cards`;

function receiptProps(output: string, testid: string): CommandBlockProps {
  const message: ShellExchangeMessage = {
    kind: "shell_exchange",
    messageKey: testid,
    createdAt: 0,
    exchangeId: testid,
    command: "/commit",
    output,
    exitCode: 0,
    cwd: "/Users/dev/src/test-repo",
    cwdAfter: "/Users/dev/src/test-repo",
    startedAtMs: 0,
    settledAtMs: 0,
  };
  return { message };
}

export function GalleryCommitReceipt(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-commit-receipt">
      <div className="cg-section" data-testid="commit-receipt-wrapping">
        <TugLabel className="cg-section-title">
          wrapping subject — baseline vs the “Commit” name, header bottom padding
        </TugLabel>
        <SessionCommitReceiptBlock {...receiptProps(OUTPUT_WRAPPING, "wrapping")} />
      </div>

      <TugSeparator />

      <div className="cg-section" data-testid="commit-receipt-one-line">
        <TugLabel className="cg-section-title">single-line subject</TugLabel>
        <SessionCommitReceiptBlock {...receiptProps(OUTPUT_ONE_LINE, "one-line")} />
      </div>
    </div>
  );
}
