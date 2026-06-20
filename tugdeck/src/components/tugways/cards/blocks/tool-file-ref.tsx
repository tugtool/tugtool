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
 * The treatment is deliberately the inline icon+text vocabulary so it
 * reads like a file mention in prose. It is the reference style a later
 * step joins markdown file-mentions to — set here first so there is a
 * concrete anchor to point back at.
 *
 * Composition:
 *  - Sits in the header's `detail` slot, which establishes the code
 *    font + muted tone. The ref inherits both, so the basename matches
 *    a Bash command's text exactly and the two read as one vocabulary.
 *  - The glyph inherits `currentColor`, so it tracks the same muted
 *    tone and any theme switch repaints it for free.
 *
 * Laws:
 *  - [L06] appearance is pure CSS + inherited tokens; no React state.
 *  - [L19] file pair (`.tsx` + `.css`), exported props, `data-slot`.
 *
 * @module components/tugways/cards/blocks/tool-file-ref
 */

import "./tool-file-ref.css";

import React from "react";
import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ToolFileRefProps {
  /**
   * Full file path. The basename is shown; the full path surfaces as
   * the native hover tooltip (`title`).
   */
  path: string;
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
  icon,
  "data-slot": dataSlot = "tool-file-ref",
  className,
}: ToolFileRefProps): React.ReactElement {
  const name = fileRefBasename(path);
  return (
    <span
      className={cn("tool-file-ref", className)}
      title={path}
      data-slot={dataSlot}
    >
      <span className="tool-file-ref-icon" aria-hidden="true">
        {icon ?? <FileText />}
      </span>
      {name}
    </span>
  );
}
