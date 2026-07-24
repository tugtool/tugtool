/**
 * `CommitShaText` — a commit's short sha as `code`-colored monospace text.
 *
 * One atom shared by every surface that names a commit: the History shade's
 * rows and the `/commit` receipt's header. The display length and the tint
 * live here, so a sha reads identically wherever it appears and the two
 * surfaces can't drift apart.
 *
 * Right-click → Copy writes `Commit <short sha>` — the sha as it reads on the
 * row, prefixed so a paste lands as a sentence-ready reference rather than a
 * bare token. The complete 40-char hash comes from the row's Copy button, which
 * writes the whole commit record.
 *
 * @module components/tugways/commit-sha-text
 */

import "./commit-sha-text.css";

import React, { useRef } from "react";

import { useCopyableText } from "@/components/tugways/use-copyable-text";

/** Short-sha display length — enough to uniquely name a commit at a glance. */
export const SHA_DISPLAY_LEN = 8;

export function CommitShaText({
  sha,
  className,
}: {
  /** The full commit sha; displayed and copied truncated to the short form. */
  sha: string;
  className?: string;
}): React.ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const { composedRef, handleContextMenu, contextMenu } = useCopyableText({
    ref,
    getText: () => `Commit ${sha.slice(0, SHA_DISPLAY_LEN)}`,
    copyMenu: true,
  });
  return (
    <>
      <code
        ref={composedRef}
        className={
          className !== undefined ? `commit-sha-text ${className}` : "commit-sha-text"
        }
        onContextMenu={handleContextMenu}
      >
        {sha.slice(0, SHA_DISPLAY_LEN)}
      </code>
      {contextMenu}
    </>
  );
}
