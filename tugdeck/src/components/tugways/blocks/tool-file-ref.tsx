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
 * The ref is a LINK into the Text card, but it owns none of that
 * behavior: it stamps the annotator's file-path annotation and the
 * transcript's delegated layer supplies the gesture — the same click and
 * the same context menu a file path written in assistant prose gets.
 * There is one interaction path for every file reference in the
 * transcript, and this is one of its sources rather than a parallel
 * implementation of it.
 *
 * Born confirmed: the tool this header describes just read or wrote this
 * file, which is stronger evidence than any probe. It carries no
 * existence check and never waits on one.
 *
 * Focus discipline (`data-tug-focus="refuse"`, `data-no-activate`, and
 * the mousedown default suppressed) rides the annotation itself, stamped
 * by the annotator for every kind that opens another surface — so
 * clicking this never steals first-responder status from wherever the
 * user is typing.
 *
 * Laws:
 *  - [L06] appearance is pure CSS + inherited tokens; no React state.
 *  - [L11] the ref is a control — it declares itself a file reference;
 *    the deck level owns the state acting on it mutates.
 *  - [L19] file pair (`.tsx` + `.css`), exported props, `data-slot`.
 *
 * @module components/tugways/blocks/tool-file-ref
 */

import "./tool-file-ref.css";

import React from "react";
import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { ANNOTATION_CLASS } from "@/lib/annotator/types";
import { datasetForPayload } from "@/lib/annotator/payloads";

export interface ToolFileRefProps {
  /**
   * Full file path. The basename is shown; the full path surfaces as
   * the native hover tooltip (`title`).
   */
  path: string;
  /**
   * 1-based line the reference points at (e.g. a Read's `offset`).
   * Carried on the annotation so the editor lands on the relevant line,
   * not just the file. Ignored when {@link range} is set.
   */
  line?: number;
  /**
   * 1-based inclusive range of the changed line(s) the reference touched
   * (e.g. an Edit's first changed lines — not the surrounding context).
   * When set, a click jumps to and momentarily flashes exactly these
   * lines; takes precedence over {@link line}.
   */
  range?: { startLine: number; endLine: number };
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
  range,
  icon,
  "data-slot": dataSlot = "tool-file-ref",
  className,
}: ToolFileRefProps): React.ReactElement {
  const name = fileRefBasename(path);

  // A cited range wins over a bare line, so a click flashes exactly the
  // lines the tool changed.
  const dataset = datasetForPayload(
    range !== undefined
      ? {
          kind: "file-path",
          path,
          line: range.startLine,
          endLine: range.endLine,
        }
      : line !== undefined
        ? { kind: "file-path", path, line }
        : { kind: "file-path", path },
  );

  return (
    <span
      className={cn(
        "tool-file-ref",
        "tool-file-ref--link",
        ANNOTATION_CLASS,
        className,
      )}
      title={path}
      data-slot={dataSlot}
      // Opts the basename into transcript Find — header text, searchable in
      // both collapse states. The icon span holds an SVG with no text
      // nodes, so the unit's text is exactly the basename, which is what
      // `tool-header-projection` projects. The full path is the tooltip
      // only, and Find matches what is displayed.
      data-tugx-findable=""
      data-tug-annotation="file-path"
      data-path={dataset.path}
      data-line={dataset.line}
      data-end-line={dataset.endLine}
      data-tug-focus="refuse"
      // Opening a file activates the TARGET card's pane; this ref must
      // not also activate its OWN host pane. `pane-focus-controller`'s
      // capture-phase pointerdown listener walks up for `data-no-activate`
      // and short-circuits — without it the host pane activates on
      // pointerdown and the target pane, activated by the click, flashes
      // active then loses it back to the host.
      data-no-activate=""
    >
      <span className="tool-file-ref-icon" aria-hidden="true">
        {icon ?? <FileText />}
      </span>
      {name}
    </span>
  );
}
