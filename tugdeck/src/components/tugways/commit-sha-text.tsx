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
  content,
  className,
}: {
  /** The full commit sha; displayed and copied truncated to the short form. */
  sha: string;
  /**
   * The short sha rendered with decoration — filter-match `<mark>`s, say.
   * MUST read as the same characters the plain form shows; it replaces how the
   * sha is painted, never what it says. Omitted ⇒ the plain short text.
   */
  content?: React.ReactNode;
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
        onContextMenu={(event) => {
          event.stopPropagation();
          handleContextMenu(event);
        }}
        // The sha is a copy target, not a toggle. Every pointer gesture on it
        // ends here rather than reaching a host that treats a click on the row
        // as activation — otherwise right-clicking a hash in the History shade
        // folds the row out from under its own menu.
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {content ?? sha.slice(0, SHA_DISPLAY_LEN)}
      </code>
      {/* The copy menu's own gestures stop here. A React portal still bubbles
          through the REACT tree, so without this a click on the menu's Copy
          item would reach whatever wraps the sha — in the History shade, the
          row's expand toggle — and fold the row on a right-click. `display:
          contents` keeps the wrapper out of the host's layout. */}
      <span
        className="commit-sha-text-menu"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        {contextMenu}
      </span>
    </>
  );
}
