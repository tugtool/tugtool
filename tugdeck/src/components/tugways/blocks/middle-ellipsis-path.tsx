/**
 * `MiddleEllipsisPath` — shared header path renderer for tool blocks.
 *
 * A file path rendered with a *middle* ellipsis: the head segment
 * shrinks and ellipsizes from its trailing edge while a fixed-length
 * tail (the filename plus a little of its directory) stays pinned, so
 * a long path collapses as `/Users/koci…RTY_NOTICES.md` rather than
 * end-truncating away the filename or growing a scrollbar.
 *
 * The truncation itself is `TugPath`'s — the same mechanism the document
 * masthead's path line wears, authored once. What this adds is the tool
 * block's own: the `<code>` slot and mono face, transcript Find, the
 * tooltip, and a FIXED tail length, because these paths stand in a column
 * where a per-filename split would ragged the tails.
 *
 * A hover tooltip surfaces the full path, but only when it is actually
 * clipped: `TugTooltip`'s `suppressOpen` gate runs `pathTooltipSuppressed`
 * on each hover, which compares the head's `scrollWidth` against its
 * `clientWidth`.
 *
 * Per [#bk-conformance] item 8 this is THE path-truncation pattern for
 * tool-block headers. `ReadToolBlock` and `EditToolBlock` both
 * compose it; a new tool block with a `Tool · {path}` header should too,
 * rather than composing `TugPath` directly and re-deriving the tail
 * length, the slot, and the tooltip around it.
 *
 * Laws:
 *  - [L06] no React state — the truncation is pure CSS; the tooltip's
 *    open/closed state lives in `TugTooltip`'s own DOM-driven
 *    machinery, not here.
 *  - [L19] file pair (`.tsx` + `.css`). The component carries no
 *    `data-slot` of its own — it is a header fragment, and the
 *    `<code data-slot="tool-block-path">` it renders is the slot.
 *  - [L20] consumes only `--tugx-block-*` (inherited from the
 *    composing chrome) and introduces no tokens.
 *
 * @module components/tugways/blocks/middle-ellipsis-path
 */

import "./middle-ellipsis-path.css";

import React from "react";

import { TugTooltip } from "@/components/tugways/tug-tooltip";
import { TugPath, pathHeadClipped } from "@/components/tugways/tug-path";

/**
 * Number of trailing characters of the path kept unshrinkable so the
 * filename (and a little of its directory) always stays legible. A
 * fixed count rather than the filename, because these paths stand in a
 * COLUMN and a per-row split would ragged the tails.
 */
const PATH_TAIL_LENGTH = 20;

/**
 * Tooltip-suppression predicate for the path: suppress (return `true`)
 * unless the head segment is actually clipped, so a path showing whole
 * never explains itself. Measured fresh on each hover by `TugTooltip`.
 */
export function pathTooltipSuppressed(trigger: Element): boolean {
  return !pathHeadClipped(trigger);
}

export interface MiddleEllipsisPathProps {
  /** The file path to render. */
  path: string;
  /**
   * The whole path, when what is rendered is a shortened form of it (a
   * workspace-relative row). The tooltip shows this, so the full location is
   * one hover away even where the column shows only the part that varies.
   *
   * @default path
   */
  fullPath?: string;
  /**
   * Stamps `data-tugx-findable` on the path element, opting it into
   * transcript Find. Set by the tool-call header that composes it (the
   * fetched URL), whose text `tool-header-projection` projects. Off by
   * default: the body kinds that also render paths (`path-list-block`,
   * `commit-block`, `search-result-block`) are not projected, and an
   * unprojected unit would desync the match count from the paint.
   *
   * The truncation is pure CSS — both halves of the path are real text —
   * so the unit's text is the whole path however it is clipped.
   */
  findable?: boolean;
}

/**
 * Render a file path with a middle ellipsis (see module docstring).
 */
export function MiddleEllipsisPath({
  path,
  fullPath,
  findable = false,
}: MiddleEllipsisPathProps): React.ReactElement {
  return (
    <TugTooltip
      content={fullPath ?? path}
      side="bottom"
      suppressOpen={pathTooltipSuppressed}
    >
      {/* The `<code>` is the slot and the mono face; the truncation is
          `TugPath`'s, so the head/tail split is authored once for every
          surface that shows a path. */}
      <code
        data-slot="tool-block-path"
        className="tool-block-path"
        data-tugx-findable={findable ? "" : undefined}
      >
        <TugPath path={path} tailLength={PATH_TAIL_LENGTH} />
      </code>
    </TugTooltip>
  );
}
