/**
 * `EditToolBlock` — Layer-2 wrapper for the Edit / MultiEdit tools.
 *
 * Composes `ToolBlockChrome` (header / status / error band) around a
 * `DiffBlock` body kind. Per [Spec S03] / [Table T02] / [D05]:
 *
 *   - **Header:** file-pen icon + tool name + an atom-chip showing
 *     the file's basename (via the shared `<TugAtomChip>` primitive,
 *     per [D08](roadmap/dev-atoms.md#d08-tool-block-only) /
 *     [Step 7](roadmap/dev-atoms.md#step-7)) + an inline `+N −M`
 *     change-count badge computed from the diff. `MultiEdit` resolves
 *     to this wrapper through the `multiedit → edit` alias ([D16]);
 *     the header shows whatever name the wire carried, so a MultiEdit
 *     call reads as "MultiEdit" — honest over relabelled.
 *   - **Body:** `DiffBlock` composed `embedded={true}` — the wrapper
 *     chrome owns identity, so `DiffBlock`'s own path/stats header is
 *     suppressed and its fold / view-toggle affordances portal into
 *     the chrome's actions slot.
 *
 * Diff composition (`composeEditDiffData`):
 *
 *   - **Primary — `structuredPatch`.** Claude Code's Edit tool emits a
 *     `structured_result` carrying `structuredPatch: StructuredPatchHunk[]`
 *     (the `diff` package's hunk shape). It already reflects the full
 *     edit — a single replacement AND a `replace_all` that changed N
 *     occurrences are both just "every changed hunk across the file."
 *     `structuredPatchToHunks` converts it to `DiffHunk[]` and the body
 *     renders via `DiffData{source:"hunks"}` — synchronous, first-paint
 *     ready, no WASM. This supersedes the original step text's
 *     "`(old_string, new_string)` or full-file diff if `replace_all`"
 *     branch: `structuredPatch` is the full-file diff, uniformly.
 *   - **Fallback — `two-text`.** When no `structuredPatch` is present
 *     (drift / an older catalog / a partial structured event), the
 *     wrapper falls back to `DiffData{source:"two-text"}` built from
 *     `(oldString, newString)` — preferring the structured result's
 *     copies, with `tool_use.input` as the backstop. `DiffBlock`
 *     lazy-loads `tugdiff-wasm` for that source. In this degraded path
 *     a `replace_all` edit shows the representative single replacement
 *     (there is no full-file content to do better with); the change-
 *     count badge is omitted because the counts aren't known wrapper-
 *     side until the body computes them.
 *
 * Streaming / error:
 *
 *   - `status === "streaming"` → header shows whatever input fragment
 *     has arrived; body is `<StreamingPlaceholder />`.
 *   - `status === "error"` → chrome paints the error stripe and the
 *     plain-text `tool_result.output` (the edit-failure message)
 *     renders inline; the body is dropped so the failure reads as the
 *     primary content (mirrors `ReadToolBlock`).
 *   - `status === "ready"` → steady-state render.
 *
 * Registration:
 *
 *   `dev-assistant-renderer-dispatch.ts` imports this module and calls
 *   `registerToolBlock("edit", EditToolBlock)` from its own
 *   bottom-of-file initialization — the `multiedit` alias resolves
 *   there too. Routing registration through dispatch (rather than
 *   self-registering) keeps the import graph one-directional:
 *   dispatch → wrapper → chrome / body kind → types.
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM attributes;
 *    body composition is pure props derived via `useMemo`.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="edit-tool-block"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the body's
 *    `--tugx-diff-*`; the change-count badge rides the shared
 *    `--tugx-block-tone-*` add / remove tones. No new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — `DiffBlock` owns diff rendering, the
 *    wrapper owns chrome and the tool-specific change-count summary.
 *  - [D16] `multiedit → edit` alias — one wrapper renders both tools.
 *
 * @module components/tugways/cards/tool-blocks/edit-tool-block
 */

import "./edit-tool-block.css";
import "@/lib/tug-atom-chip.css";

import React from "react";
import { FilePenLine } from "lucide-react";

import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import {
  countDiffStats,
  type DiffData,
  type DiffHunk,
  type DiffLine,
} from "@/lib/diff/types";
import { TugAtomChip } from "@/lib/tug-atom-chip";
import { formatAtomLabel } from "@/lib/tug-atom-img";

import {
  StreamingPlaceholder,
  ToolBlockChrome,
} from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings
// ---------------------------------------------------------------------------

/**
 * Edit tool input — the wire fields under `tool_use.input`. `Edit` and
 * `MultiEdit` share this shape closely enough that one narrowing
 * serves both: `MultiEdit` carries an `edits[]` array rather than a
 * single `old_string` / `new_string`, but its `structured_result`
 * still emits a unified `structuredPatch`, which is the wrapper's
 * canonical source — so the per-edit input fields are only the
 * fallback's backstop.
 */
export interface EditToolInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

/**
 * One hunk of the `diff` package's `structuredPatch` — the shape
 * Claude Code's Edit `structured_result` carries. `lines` are the raw
 * hunk lines, each prefixed with `" "` (context) / `"+"` (add) /
 * `"-"` (remove); a `"\"`-prefixed line is the "No newline at end of
 * file" sentinel (patch metadata, not content).
 */
export interface EditPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Edit tool structured result — the wire shape under
 * `tool_use_structured.structured_result`. Every field is optional and
 * defensively narrowed: the wrapper degrades gracefully when a
 * partial / drifted event arrives. `structuredPatch` is the canonical
 * diff source; `oldString` / `newString` feed the fallback.
 */
export interface EditStructuredResult {
  filePath?: string;
  oldString?: string;
  newString?: string;
  structuredPatch?: EditPatchHunk[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Narrow the wrapper-side `unknown` input to {@link EditToolInput}. */
export function narrowEditInput(value: unknown): EditToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    file_path: typeof v.file_path === "string" ? v.file_path : undefined,
    old_string: typeof v.old_string === "string" ? v.old_string : undefined,
    new_string: typeof v.new_string === "string" ? v.new_string : undefined,
    replace_all:
      typeof v.replace_all === "boolean" ? v.replace_all : undefined,
  };
}

/**
 * Narrow one raw `structuredPatch` entry. Returns `null` when any of
 * the four numeric counters is missing or `lines` is not an array —
 * a malformed hunk is dropped rather than rendered half-formed.
 */
function narrowPatchHunk(value: unknown): EditPatchHunk | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.oldStart !== "number" ||
    typeof v.oldLines !== "number" ||
    typeof v.newStart !== "number" ||
    typeof v.newLines !== "number" ||
    !Array.isArray(v.lines)
  ) {
    return null;
  }
  return {
    oldStart: v.oldStart,
    oldLines: v.oldLines,
    newStart: v.newStart,
    newLines: v.newLines,
    lines: v.lines.filter((l): l is string => typeof l === "string"),
  };
}

/** Narrow the wrapper-side `unknown` structured result. */
export function narrowEditStructured(value: unknown): EditStructuredResult {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const rawPatch = v.structuredPatch;
  const structuredPatch = Array.isArray(rawPatch)
    ? rawPatch
        .map(narrowPatchHunk)
        .filter((h): h is EditPatchHunk => h !== null)
    : undefined;
  return {
    filePath: typeof v.filePath === "string" ? v.filePath : undefined,
    oldString: typeof v.oldString === "string" ? v.oldString : undefined,
    newString: typeof v.newString === "string" ? v.newString : undefined,
    structuredPatch:
      structuredPatch !== undefined && structuredPatch.length > 0
        ? structuredPatch
        : undefined,
  };
}

/**
 * Convert the `diff` package's `structuredPatch` hunks to the
 * `DiffHunk[]` shape `DiffBlock` consumes. Walks each hunk's prefixed
 * `lines`, classifying by the leading marker and advancing the
 * per-side 1-based line counters:
 *
 *   - `" "` (or any unrecognized prefix — defensive) → `context`,
 *     both counters advance.
 *   - `"+"` → `add`, `before_lineno` is `null`, `after` advances.
 *   - `"-"` → `remove`, `after_lineno` is `null`, `before` advances.
 *   - `"\"` → the "No newline at end of file" sentinel; skipped — it
 *     is patch metadata, never a `DiffLine`.
 *
 * `structuredPatch` carries no trailing `@@` header text, so
 * `header` is `""`.
 */
export function structuredPatchToHunks(
  patch: readonly EditPatchHunk[],
): DiffHunk[] {
  return patch.map((h) => {
    const lines: DiffLine[] = [];
    let beforeLine = h.oldStart;
    let afterLine = h.newStart;
    for (const raw of h.lines) {
      const marker = raw.charAt(0);
      if (marker === "\\") continue;
      const content = raw.slice(1);
      if (marker === "+") {
        lines.push({
          kind: "add",
          content,
          before_lineno: null,
          after_lineno: afterLine,
        });
        afterLine += 1;
      } else if (marker === "-") {
        lines.push({
          kind: "remove",
          content,
          before_lineno: beforeLine,
          after_lineno: null,
        });
        beforeLine += 1;
      } else {
        lines.push({
          kind: "context",
          content,
          before_lineno: beforeLine,
          after_lineno: afterLine,
        });
        beforeLine += 1;
        afterLine += 1;
      }
    }
    return {
      before_start: h.oldStart,
      before_count: h.oldLines,
      after_start: h.newStart,
      after_count: h.newLines,
      header: "",
      lines,
    };
  });
}

/**
 * Compose the `DiffData` payload `DiffBlock` renders. `structuredPatch`
 * is the canonical source — it reflects both single edits and
 * `replace_all` uniformly, renders synchronously, and needs no WASM.
 * The `two-text` fallback covers the structured-result-absent case.
 * Returns `undefined` when there is nothing to diff (the wrapper then
 * drops the body).
 */
export function composeEditDiffData(
  input: EditToolInput,
  structured: EditStructuredResult,
): DiffData | undefined {
  const rawPath = structured.filePath ?? input.file_path ?? "";
  const filePath = rawPath === "" ? undefined : rawPath;

  if (
    structured.structuredPatch !== undefined &&
    structured.structuredPatch.length > 0
  ) {
    return {
      source: "hunks",
      hunks: structuredPatchToHunks(structured.structuredPatch),
      filePath,
    };
  }

  const before = structured.oldString ?? input.old_string;
  const after = structured.newString ?? input.new_string;
  if (before !== undefined && after !== undefined) {
    return { source: "two-text", before, after, filePath };
  }

  return undefined;
}

/**
 * Total add / remove counts for the header badge. Only the `hunks`
 * source carries counts the wrapper can read directly; the `two-text`
 * fallback computes its diff inside `DiffBlock` and reports nothing
 * back, so this returns `undefined` there and the badge is omitted.
 */
export function composeEditChangeCounts(
  data: DiffData | undefined,
): { added: number; removed: number } | undefined {
  if (data === undefined || data.source !== "hunks") return undefined;
  return countDiffStats(data.hunks);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EditToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  structuredResult,
  textOutput,
  status,
  caution,
}) => {
  const editInput = React.useMemo(() => narrowEditInput(input), [input]);
  const structured = React.useMemo(
    () => narrowEditStructured(structuredResult),
    [structuredResult],
  );
  const diffData = React.useMemo(
    () => composeEditDiffData(editInput, structured),
    [editInput, structured],
  );
  const changeCounts = React.useMemo(
    () => composeEditChangeCounts(diffData),
    [diffData],
  );

  const filePath = structured.filePath ?? editInput.file_path;
  const argsSummary =
    filePath !== undefined && filePath.length > 0 ? (
      <span className="edit-tool-block-args">
        <TugAtomChip
          type="file"
          label={formatAtomLabel(filePath, "filename")}
          value={filePath}
          data-slot="edit-tool-block-path"
          className="tug-atom-chip"
        />
        {changeCounts !== undefined ? (
          <span
            data-slot="edit-tool-block-stats"
            className="edit-tool-block-stats"
            aria-label={`${changeCounts.added} added, ${changeCounts.removed} removed`}
          >
            <span className="edit-tool-block-stats-add">
              +{changeCounts.added}
            </span>
            <span className="edit-tool-block-stats-remove">
              −{changeCounts.removed}
            </span>
          </span>
        ) : null}
      </span>
    ) : undefined;

  // Errored edits carry the failure message in `textOutput` (e.g.
  // "old_string not found"). When errored, prefer the chrome's error
  // band — don't double-render through the body.
  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="edit-tool-block-error-output">{textOutput}</span>
    ) : undefined;

  // Body: streaming → placeholder; error → none (the chrome's error
  // band is the primary content); ready → the embedded DiffBlock when
  // there is something to diff.
  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else if (status === "error") {
    body = null;
  } else if (diffData !== undefined) {
    body = (
      <DiffBlock
        data={diffData}
        embedded
        className="edit-tool-block-diff"
        componentStatePreservationKey={`${toolUseId}-body`}
      />
    );
  } else {
    body = null;
  }

  return (
    <ToolBlockChrome
      rootSlot="edit-tool-block"
      toolName={toolName}
      toolIcon={<FilePenLine size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolBlockChrome>
  );
};
