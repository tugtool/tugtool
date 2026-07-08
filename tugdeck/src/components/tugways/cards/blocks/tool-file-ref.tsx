/**
 * `ToolFileRef` — the inline file reference shown in a tool-call header.
 *
 * Replaces the boxed `<TugAtomChip>` for the file-tool identities
 * (Write / Edit / Read / NotebookEdit). An atom chip is an *editing*
 * affordance — a bordered, filled, selectable token that belongs in an
 * editable substrate. In a read-only transcript header it reads as
 * distracting chrome. This component is the *display* form: a small
 * muted file glyph + the file's basename in the surrounding code font,
 * on a transparent surface — no box, no fill, no border. The full path
 * is the hover tooltip.
 *
 * The ref is a LINK into the File card: a primary click dispatches the
 * `open-file` action (`{ path, line? }` through `dispatchAction`), so
 * the file the assistant just read or edited opens in an editor —
 * reusing an existing File card bound to the same path. A right-click
 * offers Open in Editor / Show in Finder via `TugContextMenu` (chain
 * actions carrying the path as `value`, handled by DeckCanvas).
 *
 * Focus discipline: the ref carries `data-tug-focus="refuse"` so
 * clicking it never steals first-responder status from wherever the
 * user is typing — the File card claims focus itself through the
 * activation path, exactly like any other card activation.
 *
 * Laws:
 *  - [L06] appearance is pure CSS + inherited tokens; no React state.
 *  - [L11] the ref is a control — it emits `open-file`; the deck level
 *    owns the state the action mutates.
 *  - [L19] file pair (`.tsx` + `.css`), exported props, `data-slot`.
 *
 * @module components/tugways/cards/blocks/tool-file-ref
 */

import "./tool-file-ref.css";

import React, { useCallback } from "react";
import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { dispatchAction } from "@/action-dispatch";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

export interface ToolFileRefProps {
  /**
   * Full file path. The basename is shown; the full path surfaces as
   * the native hover tooltip (`title`).
   */
  path: string;
  /**
   * 1-based line the reference points at (e.g. a Read's `offset`).
   * Carried on the `open-file` dispatch so the editor lands on the
   * relevant line, not just the file.
   */
  line?: number;
  /**
   * Leading glyph. Defaults to a generic file-document icon
   * (`FileText`). A tool with a more specific shape (a notebook, say)
   * may pass its own lucide node.
   */
  icon?: React.ReactNode;
  "data-slot"?: string;
  className?: string;
}

/**
 * Compute a path's basename — the segment after the last `/`, with any
 * trailing slashes ignored. A path with no separator returns unchanged.
 */
export function fileRefBasename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function ToolFileRef({
  path,
  line,
  icon,
  "data-slot": dataSlot = "tool-file-ref",
  className,
}: ToolFileRefProps): React.ReactElement {
  const name = fileRefBasename(path);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      // Plain primary click only — modified clicks fall through so
      // text selection gestures over the header stay intact.
      if (event.button !== 0 || event.metaKey || event.shiftKey) return;
      const payload: Record<string, unknown> = {
        action: TUG_ACTIONS.OPEN_FILE,
        path,
      };
      if (line !== undefined) payload.line = line;
      dispatchAction(payload);
    },
    [path, line],
  );

  return (
    <TugContextMenu<string>
      items={[
        {
          action: TUG_ACTIONS.OPEN_FILE,
          value: path,
          label: "Open in Editor",
        },
        {
          action: TUG_ACTIONS.REVEAL_IN_FINDER,
          value: path,
          label: "Show in Finder",
        },
      ]}
    >
      <span
        className={cn("tool-file-ref", "tool-file-ref--link", className)}
        title={path}
        data-slot={dataSlot}
        data-tug-focus="refuse"
        onClick={handleClick}
      >
        <span className="tool-file-ref-icon" aria-hidden="true">
          {icon ?? <FileText />}
        </span>
        {name}
      </span>
    </TugContextMenu>
  );
}
