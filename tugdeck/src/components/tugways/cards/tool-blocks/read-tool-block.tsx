/**
 * `ReadToolBlock` — Layer-2 wrapper for the Read tool.
 *
 * Composes `ToolBlockChrome` (header / footer / status) around a
 * `FileBlock` body kind. Per [Spec S03] / [Table T02]:
 *
 *   - **Header:** file icon + tool name "Read" + the file path
 *     pulled from `input.file_path` (truncated with hover-expand via
 *     the chrome's args-summary CSS). When `input.offset` /
 *     `input.limit` set, an inline line-range badge surfaces the
 *     window the model asked for.
 *   - **Body:** `FileBlock` in `embedded` mode, fed from
 *     `tool_use_structured.file`. The structured result carries
 *     `{ content, filePath, startLine, numLines, totalLines }`
 *     directly, mirroring `FileBlock.FileData`. There is no
 *     `tool_result.output` fallback: that payload is Claude Code's
 *     `<n>\t<line>` cat-n readback (agent-facing metadata so the
 *     model can reference line numbers in conversation), not file
 *     content. Feeding it to CM6 would produce a doubled gutter —
 *     numbers in the bytes plus CM6's own gutter. The streaming
 *     window before `tool_use_structured` lands is covered by the
 *     wrapper's `status === "streaming"` placeholder.
 *   - **Footer:** "Showing N of M lines" when the read window is a
 *     proper subset of the source file (i.e. `numLines < totalLines`).
 *     Otherwise the footer is hidden — successful full-file reads
 *     don't need a footer band.
 *
 * Streaming behavior:
 *
 *   - `status === "streaming"` → header still shows whatever input
 *     fragment has arrived (typically empty until the streaming
 *     `tool_use` continuation lands the full input); body is the
 *     `<StreamingPlaceholder />` so the row reserves vertical space
 *     without flashing partial content.
 *   - `status === "ready"` → steady-state render.
 *   - `status === "error"` → chrome paints the error stripe, the
 *     plain-text `tool_result.output` (typically the read failure
 *     message) renders inline; no body when there's no structured
 *     `file` to show.
 *
 * Registration:
 *
 *   `tide-assistant-renderer-dispatch.ts` imports this module and
 *   calls `registerToolBlock("read", ReadToolBlock)` from its own
 *   bottom-of-file initialization. Routing the registration through
 *   dispatch (rather than self-registering) preserves the
 *   one-directional import graph: dispatch → wrapper → chrome / body
 *   kind → types.
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM
 *    attributes; body composition is pure props.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="read-tool-block"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the body's
 *    `--tugx-file-*`; introduces no new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — body kind owns file rendering, wrapper
 *    owns chrome.
 *  - [D11] unknown tool variants would not reach this wrapper; the
 *    dispatch routes them to `DefaultToolBlock`.
 *
 * @module components/tugways/cards/tool-blocks/read-tool-block
 */

import "./read-tool-block.css";

import React from "react";
import { AlignLeft, FileText } from "lucide-react";

import {
  FileBlock,
  type FileData,
} from "@/components/tugways/body-kinds/file-block";
import { TugBadge } from "@/components/tugways/tug-badge";

import { MiddleEllipsisPath } from "./middle-ellipsis-path";
import {
  StreamingPlaceholder,
  ToolBlockChrome,
} from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings
// ---------------------------------------------------------------------------

/**
 * Read tool input — the wire fields we surface.
 *
 * `file_path` is the only required field. `offset` (1-based start
 * line) and `limit` (max line count) are optional; when set, the
 * header gains a line-range badge.
 */
export interface ReadToolInput {
  file_path?: string;
  offset?: number;
  limit?: number;
}

/**
 * Read tool structured result — the wire shape under
 * `tool_use_structured.structured_result`. The `file` payload maps
 * 1:1 to `FileBlock.FileData`; `type` distinguishes text from image
 * results (image rendering is a future tool block, not in scope
 * here).
 */
export interface ReadStructuredResult {
  file?: ReadStructuredFile;
  type?: string;
}

export interface ReadStructuredFile {
  content?: string;
  filePath?: string;
  startLine?: number;
  numLines?: number;
  totalLines?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function narrowInput(value: unknown): ReadToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    file_path: typeof v.file_path === "string" ? v.file_path : undefined,
    offset: typeof v.offset === "number" ? v.offset : undefined,
    limit: typeof v.limit === "number" ? v.limit : undefined,
  };
}

function narrowStructured(value: unknown): ReadStructuredResult {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const file = narrowStructuredFile(v.file);
  return {
    file,
    type: typeof v.type === "string" ? v.type : undefined,
  };
}

function narrowStructuredFile(value: unknown): ReadStructuredFile | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  return {
    content: typeof v.content === "string" ? v.content : undefined,
    filePath: typeof v.filePath === "string" ? v.filePath : undefined,
    startLine: typeof v.startLine === "number" ? v.startLine : undefined,
    numLines: typeof v.numLines === "number" ? v.numLines : undefined,
    totalLines:
      typeof v.totalLines === "number" ? v.totalLines : undefined,
  };
}

/**
 * Compose the `FileData` payload `FileBlock` consumes from the
 * structured-result `file` shape. `tool_use_structured` is the
 * canonical source for Read — its `file.content` is the clean file
 * bytes, the form CM6 expects (CM6 owns the line-number gutter).
 *
 * The `tool_result.output` payload is intentionally NOT a fallback:
 * Claude Code emits that field in a `<n>\t<line>` cat-n readback so
 * the model can reference line numbers in conversation. Those bytes
 * are agent-facing metadata, not file content; rendering them with
 * CM6 produces a doubled gutter (numbers in the bytes + CM6's own
 * gutter). The streaming window before `tool_use_structured` lands
 * is handled by the wrapper's `status === "streaming"` placeholder.
 *
 * Returns `undefined` when the structured event hasn't supplied a
 * `file.content` string — the wrapper then drops the body entirely.
 */
export function composeFileData(
  input: ReadToolInput,
  structured: ReadStructuredResult,
): FileData | undefined {
  const sf = structured.file;
  if (sf === undefined || typeof sf.content !== "string") return undefined;
  return {
    filePath: sf.filePath ?? input.file_path ?? "",
    content: sf.content,
    startLine: sf.startLine,
    numLines: sf.numLines,
    totalLines: sf.totalLines,
  };
}

/**
 * Compose the line-range badge text shown in the header when the
 * model asked for a windowed read. Returns `undefined` to suppress
 * the badge when no window is configured.
 *
 *   offset=10, limit=20 → "lines 10-29"
 *   offset=10, no limit → "from line 10"
 *   no offset, limit=20 → "first 20 lines"
 *   neither set         → undefined
 */
export function composeLineRangeBadge(
  input: ReadToolInput,
): string | undefined {
  const { offset, limit } = input;
  if (offset === undefined && limit === undefined) return undefined;
  if (offset !== undefined && limit !== undefined) {
    return `lines ${offset}–${offset + limit - 1}`;
  }
  if (offset !== undefined) return `from line ${offset}`;
  if (limit !== undefined) return `first ${limit} lines`;
  return undefined;
}

/**
 * Compose the wrapper-footer "Showing N of M lines" hint. Only fires
 * when the read window is a proper subset of the file (the
 * structured event reported both counts and `numLines < totalLines`).
 * Returns `undefined` to suppress the footer entirely.
 */
export function composeReadFooterHint(
  data: FileData | undefined,
): string | undefined {
  if (data === undefined) return undefined;
  const { numLines, totalLines } = data;
  if (
    numLines === undefined ||
    totalLines === undefined ||
    totalLines <= numLines
  ) {
    return undefined;
  }
  return `Showing ${numLines} of ${totalLines} lines`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ReadToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  structuredResult,
  textOutput,
  status,
  caution,
}) => {
  const readInput = React.useMemo(() => narrowInput(input), [input]);
  const structured = React.useMemo(
    () => narrowStructured(structuredResult),
    [structuredResult],
  );
  const fileData = React.useMemo(
    () => composeFileData(readInput, structured),
    [readInput, structured],
  );
  const lineRange = React.useMemo(
    () => composeLineRangeBadge(readInput),
    [readInput],
  );
  const footerHint = React.useMemo(
    () => composeReadFooterHint(fileData),
    [fileData],
  );

  const argsSummary =
    readInput.file_path !== undefined ? (
      <span className="read-tool-block-args">
        <MiddleEllipsisPath path={readInput.file_path} />
        {lineRange !== undefined ? (
          <TugBadge
            data-slot="read-tool-block-line-range"
            emphasis="ghost"
            role="action"
            size="md"
            icon={<AlignLeft size={12} aria-hidden="true" />}
          >
            {lineRange}
          </TugBadge>
        ) : null}
      </span>
    ) : undefined;

  // Errored reads carry the failure message in `textOutput` (e.g.
  // "ENOENT: no such file"). When errored, prefer the chrome's error
  // band — don't double-render through the body.
  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="read-tool-block-error-output">{textOutput}</span>
    ) : undefined;

  const footerBadges =
    footerHint !== undefined ? (
      <span
        data-slot="read-tool-block-showing"
        className="read-tool-block-showing"
      >
        {footerHint}
      </span>
    ) : undefined;

  // Render the body in two cases:
  //   - streaming: placeholder (chrome reserves space)
  //   - ready / non-error: the FileBlock if we have something to
  //     show. On error, the chrome's error band is enough; the
  //     wrapper drops the body so the failure message reads as the
  //     primary content.
  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else if (status === "error") {
    body = null;
  } else if (fileData !== undefined) {
    body = (
      <FileBlock
        data={fileData}
        embedded
        className="read-tool-block-file"
        componentStatePreservationKey={`${toolUseId}-body`}
      />
    );
  } else {
    body = null;
  }

  return (
    <ToolBlockChrome
      rootSlot="read-tool-block"
      toolName={toolName}
      toolIcon={<FileText size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
      footerBadges={footerBadges}
    >
      {body}
    </ToolBlockChrome>
  );
};
