/**
 * `MiddleEllipsisPath` — shared header path renderer for tool wrappers.
 *
 * A file path rendered with a *middle* ellipsis: the head segment
 * shrinks and ellipsizes from its trailing edge while a fixed-length
 * tail (the filename plus a little of its directory) stays pinned, so
 * a long path collapses as `/Users/koci…RTY_NOTICES.md` rather than
 * end-truncating away the filename or growing a scrollbar. Pure CSS —
 * two flex children, no measurement.
 *
 * A hover tooltip surfaces the full path, but only when it is actually
 * clipped: `TugTooltip`'s `suppressOpen` gate runs `pathTooltipSuppressed`
 * on each hover, which compares the head's `scrollWidth` against its
 * `clientWidth`.
 *
 * Per [#bk-conformance] item 8 this is THE path-truncation pattern for
 * tool-wrapper headers. `ReadToolBlock` and `EditToolBlock` both
 * compose it; a new wrapper with a `Tool · {path}` header should too,
 * rather than re-deriving the head/tail split.
 *
 * Laws:
 *  - [L06] no React state — the truncation is pure CSS; the tooltip's
 *    open/closed state lives in `TugTooltip`'s own DOM-driven
 *    machinery, not here.
 *  - [L19] file pair (`.tsx` + `.css`). The component carries no
 *    `data-slot` of its own — it is a header fragment, and the
 *    `<code data-slot="tool-wrapper-path">` it renders is the slot.
 *  - [L20] consumes only `--tugx-toolblock-*` (inherited from the
 *    composing chrome) and introduces no tokens.
 *
 * @module components/tugways/cards/tool-wrappers/middle-ellipsis-path
 */

import "./middle-ellipsis-path.css";

import React from "react";

import { TugTooltip } from "@/components/tugways/tug-tooltip";

/**
 * Number of trailing characters of the path kept unshrinkable so the
 * filename (and a little of its directory) always stays legible.
 */
const PATH_TAIL_LENGTH = 20;

/**
 * Tooltip-suppression predicate for the path: suppress (return `true`)
 * unless the head segment is actually clipped. The head shrinks to
 * absorb truncation, so the path is truncated exactly when the head's
 * `scrollWidth` exceeds its `clientWidth`. An absent head (path shorter
 * than the pinned tail — the full path is already visible) is never
 * truncated. Measured fresh on each hover by `TugTooltip`.
 */
export function pathTooltipSuppressed(trigger: Element): boolean {
  const head = trigger.querySelector(".tool-wrapper-path-head");
  if (head === null) return true;
  return head.scrollWidth <= head.clientWidth;
}

export interface MiddleEllipsisPathProps {
  /** The file path to render. */
  path: string;
}

/**
 * Render a file path with a middle ellipsis (see module docstring).
 */
export function MiddleEllipsisPath({
  path,
}: MiddleEllipsisPathProps): React.ReactElement {
  const head =
    path.length > PATH_TAIL_LENGTH ? path.slice(0, -PATH_TAIL_LENGTH) : "";
  const tail =
    path.length > PATH_TAIL_LENGTH ? path.slice(-PATH_TAIL_LENGTH) : path;
  return (
    <TugTooltip
      content={path}
      side="bottom"
      suppressOpen={pathTooltipSuppressed}
    >
      <code data-slot="tool-wrapper-path" className="tool-wrapper-path">
        <span className="tool-wrapper-path-head">{head}</span>
        <span className="tool-wrapper-path-tail">{tail}</span>
      </code>
    </TugTooltip>
  );
}
