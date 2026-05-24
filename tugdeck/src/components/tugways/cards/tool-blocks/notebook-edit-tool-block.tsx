/**
 * `NotebookEditToolBlock` — Layer-2 wrapper for the `NotebookEdit` tool.
 *
 * `NotebookEdit` mutates a single cell in a Jupyter notebook. It
 * supports three `edit_mode` variants: `replace` (default — overwrite
 * the cell's source), `insert` (add a new cell after the target), and
 * `delete` (remove the cell). The user's reading attention anchors
 * on three things: (a) *which notebook + cell* was touched, (b) *what
 * kind of edit*, and (c) for `replace`, *what changed*.
 *
 * Composition (per [Spec S03] / [Table T02] / [#bk-conformance]):
 *
 *  - **Header** — a `Notebook` icon + tool name + the notebook path
 *    (via `MiddleEllipsisPath`) + a `· cell {cellId}` segment when a
 *    cell id is known + a small `edit_mode` chip (`replace` / `insert`
 *    / `delete`) and a `cell_type` chip (`code` / `markdown`) when
 *    present.
 *
 *  - **Body** — for `replace`, embedded `DiffBlock` over the cell's
 *    before / after source (the `two-text` source per [Q01]'s generic
 *    v1: `DiffBlock` lazy-loads `tugdiff-wasm` for the diff compute).
 *    For `insert`, embedded `FileBlock` over the new cell source.
 *    For `delete`, a small confirmation row (no body content — the
 *    cell is gone). For all three, a partial structured event (or no
 *    structured event at all) renders an empty body; the chrome's
 *    header chips still surface the per-cell context.
 *
 * Streaming / error ([Spec S03]):
 *
 *  - `status === "streaming"` → header still shows whatever input
 *    fragment has arrived; body is `<StreamingPlaceholder />`.
 *  - `status === "error"` → chrome paints the error band from the
 *    plain-text `tool_result.output`; body is dropped so the failure
 *    reads as the primary content.
 *  - `status === "ready"` → steady-state render.
 *
 * Wire shape (`input` and `structuredResult`):
 *
 *  - `input`: `{ notebook_path: string, new_source: string, cell_id?,
 *    cell_type?, edit_mode? }`. The notebook path is required; the
 *    other fields are optional.
 *  - `structuredResult`: `{ notebookPath?, cellId?, cellType?,
 *    editMode?, oldSource?, newSource? }`. `oldSource` is what makes
 *    the `replace` diff possible — it's the pre-edit cell source.
 *    Defensively narrowed.
 *
 * Laws:
 *  - [L06] no React state for appearance.
 *  - [L19] file pair (`.tsx` + `.css`),
 *    `data-slot="notebook-edit-tool-block"` (delegated to chrome via
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*`, `DiffBlock`'s
 *    `--tugx-diff-*`, `FileBlock`'s `--tugx-file-*`; the per-mode
 *    chips ride the chrome's caution-badge metrics.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — body kinds own diff / file render; the
 *    wrapper owns chrome + the per-cell context.
 *  - [Q01] generic `DiffBlock` v1 — no notebook-specific diff styling
 *    today; the `two-text` source handles `replace` by computing the
 *    cell-source diff via `tugdiff-wasm`.
 *  - [D101] visibility policy — `notebookedit` moves from
 *    `default-intent` to bespoke in this change; the policy entry is
 *    removed in the same commit.
 *
 * @module components/tugways/cards/tool-blocks/notebook-edit-tool-block
 */

import "./notebook-edit-tool-block.css";

import React from "react";
import {
  Code,
  FileText,
  Hash,
  Notebook,
  Plus,
  Replace,
  Trash2,
} from "lucide-react";

import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import { FileBlock } from "@/components/tugways/body-kinds/file-block";

import { TugBadge } from "@/components/tugways/tug-badge";

import { MiddleEllipsisPath } from "./middle-ellipsis-path";
import { ToolBlockBody, ToolBlockFieldRow, ToolBlockPre } from "./body-bits";
import {
  StreamingPlaceholder,
  ToolBlockChrome,
} from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings
// ---------------------------------------------------------------------------

export type NotebookEditMode = "replace" | "insert" | "delete";
export type NotebookCellType = "code" | "markdown";

const KNOWN_EDIT_MODES: ReadonlySet<string> = new Set([
  "replace",
  "insert",
  "delete",
]);

const KNOWN_CELL_TYPES: ReadonlySet<string> = new Set(["code", "markdown"]);

/** `NotebookEdit` tool input — the wire fields under `tool_use.input`. */
export interface NotebookEditInput {
  notebook_path?: string;
  new_source?: string;
  cell_id?: string;
  cell_type?: NotebookCellType;
  edit_mode?: NotebookEditMode;
}

/**
 * `NotebookEdit` tool structured result — the wire shape under
 * `tool_use_structured.structured_result`. Every field is optional
 * and defensively narrowed: a partial / drifted event degrades
 * gracefully. `oldSource` is the pre-edit cell content that makes
 * the `replace` diff possible.
 */
export interface NotebookEditStructured {
  notebookPath?: string;
  cellId?: string;
  cellType?: NotebookCellType;
  editMode?: NotebookEditMode;
  oldSource?: string;
  newSource?: string;
}

function narrowEditMode(value: unknown): NotebookEditMode | undefined {
  if (typeof value !== "string") return undefined;
  return KNOWN_EDIT_MODES.has(value)
    ? (value as NotebookEditMode)
    : undefined;
}

function narrowCellType(value: unknown): NotebookCellType | undefined {
  if (typeof value !== "string") return undefined;
  return KNOWN_CELL_TYPES.has(value)
    ? (value as NotebookCellType)
    : undefined;
}

/** Narrow the wrapper-side `unknown` input to {@link NotebookEditInput}. */
export function narrowNotebookEditInput(value: unknown): NotebookEditInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    notebook_path:
      typeof v.notebook_path === "string" ? v.notebook_path : undefined,
    new_source:
      typeof v.new_source === "string" ? v.new_source : undefined,
    cell_id: typeof v.cell_id === "string" ? v.cell_id : undefined,
    cell_type: narrowCellType(v.cell_type),
    edit_mode: narrowEditMode(v.edit_mode),
  };
}

/** Narrow the wrapper-side `unknown` structured result. */
export function narrowNotebookEditStructured(
  value: unknown,
): NotebookEditStructured {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    notebookPath:
      typeof v.notebookPath === "string" ? v.notebookPath : undefined,
    cellId: typeof v.cellId === "string" ? v.cellId : undefined,
    cellType: narrowCellType(v.cellType),
    editMode: narrowEditMode(v.editMode),
    oldSource: typeof v.oldSource === "string" ? v.oldSource : undefined,
    newSource: typeof v.newSource === "string" ? v.newSource : undefined,
  };
}

/**
 * Resolve the edit mode the wrapper renders against. Prefers the
 * structured result, falls back to the input, defaults to `replace`
 * (the default on the wire). Pure and exported for tests.
 */
export function resolveNotebookEditMode(
  input: NotebookEditInput,
  structured: NotebookEditStructured,
): NotebookEditMode {
  return structured.editMode ?? input.edit_mode ?? "replace";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const NotebookEditToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  structuredResult,
  textOutput,
  status,
  caution,
}) => {
  const editInput = React.useMemo(
    () => narrowNotebookEditInput(input),
    [input],
  );
  const structured = React.useMemo(
    () => narrowNotebookEditStructured(structuredResult),
    [structuredResult],
  );
  const editMode = React.useMemo(
    () => resolveNotebookEditMode(editInput, structured),
    [editInput, structured],
  );
  const cellType = structured.cellType ?? editInput.cell_type;
  const cellId = structured.cellId ?? editInput.cell_id;
  const notebookPath = structured.notebookPath ?? editInput.notebook_path;
  const newSource = structured.newSource ?? editInput.new_source;
  const oldSource = structured.oldSource;

  const argsSummary =
    notebookPath !== undefined ? (
      <span className="notebook-edit-tool-block-args">
        <MiddleEllipsisPath path={notebookPath} />
        {cellId !== undefined ? (
          <TugBadge
            data-slot="notebook-edit-tool-block-cell"
            emphasis="ghost"
            role="action"
            size="md"
            icon={<Hash size={12} aria-hidden="true" />}
          >
            {cellId}
          </TugBadge>
        ) : null}
        <TugBadge
          data-slot="notebook-edit-tool-block-edit-mode"
          emphasis="ghost"
          role="action"
          size="md"
          icon={
            editMode === "insert" ? (
              <Plus size={12} aria-hidden="true" />
            ) : editMode === "delete" ? (
              <Trash2 size={12} aria-hidden="true" />
            ) : (
              <Replace size={12} aria-hidden="true" />
            )
          }
        >
          {editMode}
        </TugBadge>
        {cellType !== undefined ? (
          <TugBadge
            data-slot="notebook-edit-tool-block-cell-type"
            emphasis="ghost"
            role="action"
            size="md"
            icon={
              cellType === "code" ? (
                <Code size={12} aria-hidden="true" />
              ) : (
                <FileText size={12} aria-hidden="true" />
              )
            }
          >
            {cellType}
          </TugBadge>
        ) : null}
      </span>
    ) : undefined;

  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <ToolBlockPre>{textOutput}</ToolBlockPre>
    ) : undefined;

  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else if (status === "error") {
    body = null;
  } else if (editMode === "delete") {
    // Delete has no source to display — render a small confirmation
    // row. The header already carries the cell identity, so the body
    // just needs to confirm the deletion happened.
    body = (
      <ToolBlockBody>
        <ToolBlockFieldRow label="status">
          <code>deleted</code>
        </ToolBlockFieldRow>
      </ToolBlockBody>
    );
  } else if (editMode === "replace") {
    // Replace renders a `two-text` diff between the pre-edit and
    // post-edit cell source. `DiffBlock` lazy-loads `tugdiff-wasm`
    // and computes the hunks once it's ready ([D10]).
    if (oldSource !== undefined && newSource !== undefined) {
      body = (
        <DiffBlock
          data={{
            source: "two-text",
            before: oldSource,
            after: newSource,
            filePath: notebookPath,
          }}
          embedded
          className="notebook-edit-tool-block-diff"
          componentStatePreservationKey={`${toolUseId}-body`}
        />
      );
    } else if (newSource !== undefined) {
      // No `oldSource` — show the post-edit source as a FileBlock so
      // the user still sees what landed in the cell. Degraded path
      // (drift or an older catalog without the pre-edit echo).
      body = (
        <FileBlock
          data={{ filePath: notebookPath ?? "", content: newSource }}
          embedded
          className="notebook-edit-tool-block-file"
          componentStatePreservationKey={`${toolUseId}-body`}
        />
      );
    } else {
      body = null;
    }
  } else {
    // insert — render the new cell source as a FileBlock.
    if (newSource !== undefined) {
      body = (
        <FileBlock
          data={{ filePath: notebookPath ?? "", content: newSource }}
          embedded
          className="notebook-edit-tool-block-file"
          componentStatePreservationKey={`${toolUseId}-body`}
        />
      );
    } else {
      body = null;
    }
  }

  return (
    <ToolBlockChrome
      rootSlot="notebook-edit-tool-block"
      toolName={toolName}
      toolIcon={<Notebook size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolBlockChrome>
  );
};
