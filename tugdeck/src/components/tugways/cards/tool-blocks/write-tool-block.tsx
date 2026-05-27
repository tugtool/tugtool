/**
 * `WriteToolBlock` — Layer-2 wrapper for the Write tool.
 *
 * `Write` overwrites (or creates) a file at `file_path` with the
 * supplied `content`. The load-bearing UX is "show me the path and
 * the bytes that landed there" — so the wrapper composes
 * `ToolBlockChrome` around an `embedded` `FileBlock` whose `FileData`
 * is the literal `(file_path, content)` pair from the tool input.
 *
 * Composition (per [Spec S03] / [Table T02] / [#bk-conformance]):
 *
 *  - **Header:** file-plus icon + tool name + an atom-chip showing
 *    the file's basename (via the shared `useAtomChipImgProps`,
 *    per [D08](roadmap/tide-atoms.md#d08-tool-block-only) /
 *    [Step 7](roadmap/tide-atoms.md#step-7)) + an inline `{N} lines` /
 *    `{B} bytes` size hint computed from the content, and a small
 *    `new` / `overwrite` chip that surfaces when the structured
 *    result carries a `created` boolean (Claude Code's
 *    `tool_use_structured.created` tells the wrapper which path the
 *    write took). When the created chip can't be determined (drift or
 *    an older catalog), it is simply omitted.
 *
 *  - **Body:** `FileBlock` composed `embedded={true}` — the wrapper
 *    chrome owns identity, so `FileBlock`'s own header is suppressed
 *    and its fold / find affordances portal into the chrome's actions
 *    slot. The body renders the full content; `FileBlock`'s own
 *    `DEFAULT_COLLAPSE_THRESHOLD` (80 lines per audit §5.1) handles
 *    the fold-for-long-files reading.
 *
 * Streaming / error:
 *
 *  - `status === "streaming"` → header still shows whatever input
 *    fragment has arrived; body is `<StreamingPlaceholder />`.
 *  - `status === "error"` → chrome paints the error band from the
 *    plain-text `tool_result.output` (typically "EACCES" or "ENOSPC");
 *    body is dropped so the failure reads as the primary content.
 *  - `status === "ready"` → steady-state render.
 *
 * Wire shape (`input` and `structuredResult`):
 *
 *  - `input`: `{ file_path: string, content: string }`. The content
 *    on the input IS the bytes-written authority for the body —
 *    Claude Code echoes the same content back in `structured_result`
 *    when it carries one, so we prefer the structured value when
 *    present, falling back to the input.
 *  - `structuredResult`: `{ filePath?, content?, created? }`.
 *    `created` is the new-vs-overwrite signal. Every field is
 *    defensively narrowed.
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM
 *    attributes; body composition is pure props derived via `useMemo`.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="write-tool-block"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and `FileBlock`'s
 *    `--tugx-file-*`; the size hint + new/overwrite chip ride the
 *    chrome's caution-badge metrics. No new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — `FileBlock` owns the file-bytes render;
 *    the wrapper owns chrome + the path / size / created chip.
 *  - [D101] visibility policy — `write` moves from `default-intent`
 *    to bespoke in this change; the policy entry is removed in the
 *    same commit.
 *
 * @module components/tugways/cards/tool-blocks/write-tool-block
 */

import "./write-tool-block.css";
import "@/lib/tug-atom-chip.css";

import React from "react";
import { AlignLeft, FilePlus, Replace, Sparkles } from "lucide-react";

import {
  FileBlock,
  type FileData,
} from "@/components/tugways/body-kinds/file-block";

import { TugBadge } from "@/components/tugways/tug-badge";
import { useAtomChipImgProps } from "@/lib/use-atom-chip-img-props";

import { ToolBlockPre } from "./body-bits";
import {
  StreamingPlaceholder,
  ToolBlockChrome,
} from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings
// ---------------------------------------------------------------------------

/** `Write` tool input — the wire fields under `tool_use.input`. */
export interface WriteToolInput {
  file_path?: string;
  content?: string;
}

/**
 * `Write` tool structured result — the wire shape under
 * `tool_use_structured.structured_result`. Every field is optional
 * and defensively narrowed: a partial / drifted event degrades
 * gracefully. `created` is the new-vs-overwrite signal.
 */
export interface WriteStructuredResult {
  filePath?: string;
  content?: string;
  created?: boolean;
}

/** Narrow the wrapper-side `unknown` input to {@link WriteToolInput}. */
export function narrowWriteInput(value: unknown): WriteToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    file_path: typeof v.file_path === "string" ? v.file_path : undefined,
    content: typeof v.content === "string" ? v.content : undefined,
  };
}

/** Narrow the wrapper-side `unknown` structured result. */
export function narrowWriteStructured(value: unknown): WriteStructuredResult {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    filePath: typeof v.filePath === "string" ? v.filePath : undefined,
    content: typeof v.content === "string" ? v.content : undefined,
    created: typeof v.created === "boolean" ? v.created : undefined,
  };
}

/**
 * Compose the `FileData` payload `FileBlock` consumes. Prefers the
 * structured result's `content` / `filePath` (echoed by Claude Code
 * to confirm the bytes that landed); falls back to the input. Returns
 * `undefined` when neither carries a `content` string — the wrapper
 * then drops the body.
 */
export function composeWriteFileData(
  input: WriteToolInput,
  structured: WriteStructuredResult,
): FileData | undefined {
  const content = structured.content ?? input.content;
  if (content === undefined) return undefined;
  const filePath = structured.filePath ?? input.file_path ?? "";
  return { filePath, content };
}

/**
 * Compose the header size hint. The newline count plus a 1 floors at
 * 1 line for non-empty content (a single line with no trailing
 * newline still reads as "1 line"), 0 for empty content. Returns
 * `undefined` when there is no content to size.
 */
export function composeWriteSizeLabel(
  content: string | undefined,
): string | undefined {
  if (content === undefined) return undefined;
  const lineCount =
    content.length === 0 ? 0 : content.split("\n").length;
  return `${lineCount.toLocaleString()} ${lineCount === 1 ? "line" : "lines"}`;
}

/**
 * Compose the new-vs-overwrite chip text. Returns `undefined` when
 * `created` is undefined so the chip is suppressed (rather than
 * surfacing an unknown state as an authoritative label).
 */
export function composeWriteCreatedLabel(
  created: boolean | undefined,
): string | undefined {
  if (created === undefined) return undefined;
  return created ? "new" : "overwrite";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WriteToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  structuredResult,
  textOutput,
  status,
  caution,
}) => {
  const writeInput = React.useMemo(() => narrowWriteInput(input), [input]);
  const structured = React.useMemo(
    () => narrowWriteStructured(structuredResult),
    [structuredResult],
  );
  const fileData = React.useMemo(
    () => composeWriteFileData(writeInput, structured),
    [writeInput, structured],
  );
  const sizeLabel = React.useMemo(
    () => composeWriteSizeLabel(fileData?.content),
    [fileData],
  );
  const createdLabel = React.useMemo(
    () => composeWriteCreatedLabel(structured.created),
    [structured.created],
  );

  const filePath = structured.filePath ?? writeInput.file_path;
  const pathChipProps = useAtomChipImgProps("file", filePath);
  const argsSummary =
    pathChipProps !== null ? (
      <span className="write-tool-block-args">
        <img
          {...pathChipProps}
          data-slot="write-tool-block-path"
          className="tug-atom-chip"
        />
        {sizeLabel !== undefined ? (
          <TugBadge
            data-slot="write-tool-block-size"
            emphasis="ghost"
            role="action"
            size="md"
            icon={<AlignLeft size={12} aria-hidden="true" />}
          >
            {sizeLabel}
          </TugBadge>
        ) : null}
        {createdLabel !== undefined ? (
          <TugBadge
            data-slot="write-tool-block-created"
            emphasis="ghost"
            role="action"
            size="md"
            icon={
              structured.created === true ? (
                <Sparkles size={12} aria-hidden="true" />
              ) : (
                <Replace size={12} aria-hidden="true" />
              )
            }
          >
            {createdLabel}
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
  } else if (fileData !== undefined) {
    body = (
      <FileBlock
        data={fileData}
        embedded
        className="write-tool-block-file"
        componentStatePreservationKey={`${toolUseId}-body`}
      />
    );
  } else {
    body = null;
  }

  return (
    <ToolBlockChrome
      rootSlot="write-tool-block"
      toolName={toolName}
      toolIcon={<FilePlus size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolBlockChrome>
  );
};
