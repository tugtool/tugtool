/**
 * `GlobToolBlock` — Layer-2 wrapper for the Glob tool.
 *
 * Composes `ToolBlockChrome` (header / status / error band) around
 * an `embedded` `PathListBlock` body kind. Per [Spec S03] /
 * [Table T02] / [#bk-conformance]:
 *
 *   - **Header:** a search icon + tool name + the glob pattern
 *     (end-ellipsis `<code>` with a `truncated`-gated tooltip, per
 *     conformance item 8 — a glob pattern is command-shaped, so it
 *     ellipsizes from the end like a shell command rather than via the
 *     middle-ellipsis path treatment) + an inline `{N} files` count
 *     and, when the producer capped the result, a `truncated` badge.
 *   - **Body:** `PathListBlock` composed `embedded={true}` — the
 *     wrapper chrome owns identity, so the body kind's own header is
 *     suppressed and its actions cluster (Copy + sort toggle) portals
 *     into the chrome's actions slot.
 *
 * Wire shape (`structured_result`, from the v2.1.x stream-json catalog
 * `test-21-glob-tool.jsonl`): `{ filenames: string[], numFiles: number,
 * truncated: boolean, durationMs: number }`. `composeGlobPathListData`
 * narrows it to `PathListData` — `numFiles` (or the array length)
 * becomes the `truncatedAt` total when `truncated` is set.
 *
 * Streaming / error:
 *   - `status === "streaming"` → header shows whatever input fragment
 *     has arrived; body is `<StreamingPlaceholder />`.
 *   - `status === "error"` → chrome paints the error band from the
 *     plain-text `tool_result.output`; the body is dropped.
 *   - `status === "ready"` → steady-state render.
 *
 * Registration: `dev-assistant-renderer-dispatch.ts` imports this
 * module and calls `registerToolBlock("glob", GlobToolBlock)` from
 * its own bottom-of-file initialization — keeping the import graph
 * one-directional (dispatch → wrapper → chrome / body kind → types).
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM attributes;
 *    body composition is pure props derived via `useMemo`.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="glob-tool-block"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the body's
 *    `--tugx-paths-*`; the count / truncation badges ride the chrome's
 *    existing caution-badge metrics. No new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — `PathListBlock` owns the list rendering,
 *    the wrapper owns chrome and the tool-specific header summary.
 *
 * @module components/tugways/cards/tool-blocks/glob-tool-block
 */

import "./glob-tool-block.css";

import React from "react";

import {
  PathListBlock,
  type PathListData,
} from "@/components/tugways/body-kinds/path-list-block";

import { ToolBlockChrome } from "./tool-block-chrome";
import { ToolHeaderCount, ToolHeaderTruncated } from "./tool-header-meta";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings
// ---------------------------------------------------------------------------

/** Glob tool input — the wire fields under `tool_use.input`. */
export interface GlobToolInput {
  pattern?: string;
  /** Optional search root — not surfaced in the chrome today. */
  path?: string;
}

/**
 * Glob tool structured result — the wire shape under
 * `tool_use_structured.structured_result`. Every field is optional and
 * defensively narrowed so a partial / drifted event degrades
 * gracefully.
 */
export interface GlobStructuredResult {
  filenames?: string[];
  numFiles?: number;
  truncated?: boolean;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported because tests pin them
// ---------------------------------------------------------------------------

/** Narrow the wrapper-side `unknown` input to {@link GlobToolInput}. */
export function narrowGlobInput(value: unknown): GlobToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    pattern: typeof v.pattern === "string" ? v.pattern : undefined,
    path: typeof v.path === "string" ? v.path : undefined,
  };
}

/** Narrow the wrapper-side `unknown` structured result. */
export function narrowGlobStructured(value: unknown): GlobStructuredResult {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const rawFilenames = v.filenames;
  const filenames = Array.isArray(rawFilenames)
    ? rawFilenames.filter((f): f is string => typeof f === "string")
    : undefined;
  return {
    filenames,
    numFiles: typeof v.numFiles === "number" ? v.numFiles : undefined,
    truncated: typeof v.truncated === "boolean" ? v.truncated : undefined,
    durationMs: typeof v.durationMs === "number" ? v.durationMs : undefined,
  };
}

/**
 * Compose the `PathListData` payload `PathListBlock` consumes. The
 * `filenames` array is the path list; `truncatedAt` is the producer's
 * pre-truncation total (`numFiles`, falling back to the array length)
 * when `truncated` is set. Returns `undefined` only when the
 * structured event carries no `filenames` array at all (drift /
 * streaming-incomplete) — an empty array is a valid "no matches"
 * result and still composes a (zero-length) `PathListData`.
 */
export function composeGlobPathListData(
  structured: GlobStructuredResult,
): PathListData | undefined {
  const { filenames } = structured;
  if (filenames === undefined) return undefined;
  const truncatedAt =
    structured.truncated === true
      ? structured.numFiles ?? filenames.length
      : undefined;
  return { paths: filenames, truncatedAt };
}

/**
 * Compose the header file-count label, e.g. "100 files" / "1 file".
 * Prefers the producer's `numFiles`; falls back to the array length.
 * Returns `undefined` when neither is known.
 */
export function composeGlobCountLabel(
  structured: GlobStructuredResult,
): string | undefined {
  const count = structured.numFiles ?? structured.filenames?.length;
  if (count === undefined) return undefined;
  return `${count.toLocaleString()} ${count === 1 ? "file" : "files"}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GlobToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  structuredResult,
  textOutput,
  status,
  phase,
  caution,
}) => {
  const globInput = React.useMemo(() => narrowGlobInput(input), [input]);
  const structured = React.useMemo(
    () => narrowGlobStructured(structuredResult),
    [structuredResult],
  );
  const pathListData = React.useMemo(
    () => composeGlobPathListData(structured),
    [structured],
  );
  const fileCount = structured.numFiles ?? structured.filenames?.length;

  // Pattern in the wrapping command row; count + truncated in the
  // trailing meta cluster via the shared primitives ([D06]).
  const pattern = globInput.pattern;
  const command =
    pattern !== undefined ? (
      <code data-slot="glob-tool-block-pattern">{pattern}</code>
    ) : undefined;
  const meta =
    fileCount !== undefined || structured.truncated === true ? (
      <>
        {fileCount !== undefined ? (
          <ToolHeaderCount count={fileCount} noun="file" />
        ) : null}
        {structured.truncated === true ? <ToolHeaderTruncated /> : null}
      </>
    ) : undefined;

  // Errored globs carry the failure message in `textOutput`; surface
  // it through the chrome's error band rather than the body.
  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="glob-tool-block-error-output">{textOutput}</span>
    ) : undefined;

  // Body: streaming → placeholder; error → none (the chrome's error
  // band is the primary content); ready → the embedded PathListBlock
  // when the structured result supplied a path list.
  let body: React.ReactNode;
  if (status === "streaming") {
    body = null;
  } else if (status === "error") {
    body = null;
  } else if (pathListData !== undefined) {
    body = (
      <PathListBlock
        data={pathListData}
        embedded
        className="glob-tool-block-paths"
        componentStatePreservationKey={`${toolUseId}-body`}
      />
    );
  } else {
    body = null;
  }

  return (
    <ToolBlockChrome
      rootSlot="glob-tool-block"
      toolName={toolName}
      command={command}
      meta={meta}
      status={status}
      phase={phase}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolBlockChrome>
  );
};
