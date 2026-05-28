/**
 * `GrepToolBlock` — Layer-2 wrapper for the Grep tool.
 *
 * Composes `ToolBlockChrome` (header / status / error band) around
 * one of two `embedded` body kinds, picked from the result's shape:
 *
 *   - **Content mode** — the `structured_result` carries per-file
 *     grouped `files`, so the body is an `embedded` `SearchResultBlock`
 *     ([#step-16]): matched lines with highlighted spans, surrounding
 *     context, collapsible per-file headers.
 *   - **Files-only mode** — the result carries only `filenames` (the
 *     Grep `output_mode: "files_with_matches"` shape), so the body is
 *     an `embedded` `PathListBlock` ([#step-15]) — the exact same body
 *     kind `GlobToolBlock` uses.
 *
 * Per [Spec S03] / [Table T02] / [#bk-conformance]:
 *
 *   - **Header:** a search icon + tool name + the search pattern
 *     (end-ellipsis `<code>` with a `truncated`-gated tooltip, per
 *     conformance item 8 — a regex pattern is command-shaped, so it
 *     ellipsizes from the end like a shell command rather than via the
 *     middle-ellipsis path treatment) + an inline `{N} matches` /
 *     `{M} files` count pair and, when the producer capped the
 *     result, a `truncated` badge.
 *   - **Body:** the picked body kind, composed `embedded={true}` — the
 *     wrapper chrome owns identity, so the body kind's own header is
 *     suppressed and its actions cluster portals into the chrome's
 *     actions slot.
 *
 * Wire shape (`structured_result`): `{ mode?: string, filenames?:
 * string[], files?: { path, matches }[], numFiles?: number,
 * numMatches?: number, truncated?: boolean, durationMs?: number }`.
 * `composeGrepMode` decides which body kind renders;
 * `composeGrepSearchData` / `composeGrepPathListData` narrow the wire
 * shape to the body kind's render input. Every field is optional and
 * defensively narrowed so a partial / drifted event degrades
 * gracefully.
 *
 * Streaming / error:
 *   - `status === "streaming"` → header shows whatever input fragment
 *     has arrived; body is `<StreamingPlaceholder />`.
 *   - `status === "error"` → chrome paints the error band from the
 *     plain-text `tool_result.output`; the body is dropped.
 *   - `status === "ready"` → steady-state render.
 *
 * Registration: `dev-assistant-renderer-dispatch.ts` imports this
 * module and calls `registerToolBlock("grep", GrepToolBlock)` from
 * its own bottom-of-file initialization — keeping the import graph
 * one-directional (dispatch → wrapper → chrome / body kind → types).
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM attributes;
 *    body composition is pure props derived via `useMemo`.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="grep-tool-block"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the body
 *    kinds' own slots; the count / truncation badges ride the chrome's
 *    existing caution-badge metrics. No new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — the body kinds own result rendering, the
 *    wrapper owns chrome and the tool-specific header summary.
 *
 * @module components/tugways/cards/tool-blocks/grep-tool-block
 */

import "./grep-tool-block.css";

import React from "react";
import { Search } from "lucide-react";

import {
  PathListBlock,
  type PathListData,
} from "@/components/tugways/body-kinds/path-list-block";
import {
  SearchResultBlock,
  type SearchResultContextLine,
  type SearchResultData,
  type SearchResultFile,
  type SearchResultMatch,
  type SearchResultSpan,
} from "@/components/tugways/body-kinds/search-result-block";
import { TugTooltip } from "@/components/tugways/tug-tooltip";

import {
  StreamingPlaceholder,
  ToolBlockChrome,
} from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings
// ---------------------------------------------------------------------------

/** Grep tool input — the wire fields under `tool_use.input`. */
export interface GrepToolInput {
  pattern?: string;
  /** Optional search root — not surfaced in the chrome today. */
  path?: string;
  /** Optional glob filter — not surfaced in the chrome today. */
  glob?: string;
  /** The Grep `output_mode` — "content" | "files_with_matches" | "count". */
  outputMode?: string;
}

/**
 * One file's matches in the wire structured result. `matches` stays
 * `unknown[]` here — `composeGrepSearchData` deep-narrows each entry.
 */
export interface GrepWireFile {
  path?: string;
  matches?: unknown[];
}

/**
 * Grep tool structured result — the wire shape under
 * `tool_use_structured.structured_result`. Every field is optional and
 * defensively narrowed so a partial / drifted event degrades
 * gracefully. `files` carries content-mode grouped matches;
 * `filenames` carries the files-only-mode path list.
 */
export interface GrepStructuredResult {
  mode?: string;
  filenames?: string[];
  files?: GrepWireFile[];
  numFiles?: number;
  numMatches?: number;
  truncated?: boolean;
  durationMs?: number;
}

/** Which body kind a Grep result routes to. */
export type GrepBodyMode = "content" | "files";

// ---------------------------------------------------------------------------
// Pure helpers — exported because tests pin them
// ---------------------------------------------------------------------------

/** Narrow the wrapper-side `unknown` input to {@link GrepToolInput}. */
export function narrowGrepInput(value: unknown): GrepToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    pattern: typeof v.pattern === "string" ? v.pattern : undefined,
    path: typeof v.path === "string" ? v.path : undefined,
    glob: typeof v.glob === "string" ? v.glob : undefined,
    outputMode: typeof v.output_mode === "string" ? v.output_mode : undefined,
  };
}

/** Narrow one wire `files[]` entry to {@link GrepWireFile}. */
function narrowGrepWireFile(value: Record<string, unknown>): GrepWireFile {
  return {
    path: typeof value.path === "string" ? value.path : undefined,
    matches: Array.isArray(value.matches) ? value.matches : undefined,
  };
}

/** Narrow the wrapper-side `unknown` structured result. */
export function narrowGrepStructured(value: unknown): GrepStructuredResult {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;

  const rawFilenames = v.filenames;
  const filenames = Array.isArray(rawFilenames)
    ? rawFilenames.filter((f): f is string => typeof f === "string")
    : undefined;

  const rawFiles = v.files;
  const files = Array.isArray(rawFiles)
    ? rawFiles
        .filter(
          (f): f is Record<string, unknown> =>
            f !== null && typeof f === "object",
        )
        .map(narrowGrepWireFile)
    : undefined;

  return {
    mode: typeof v.mode === "string" ? v.mode : undefined,
    filenames,
    files,
    numFiles: typeof v.numFiles === "number" ? v.numFiles : undefined,
    numMatches: typeof v.numMatches === "number" ? v.numMatches : undefined,
    truncated: typeof v.truncated === "boolean" ? v.truncated : undefined,
    durationMs: typeof v.durationMs === "number" ? v.durationMs : undefined,
  };
}

/** Narrow an `unknown` to a `[start, end]` span array, dropping junk. */
function narrowSpans(value: unknown): SearchResultSpan[] {
  if (!Array.isArray(value)) return [];
  const spans: SearchResultSpan[] = [];
  for (const entry of value) {
    if (
      Array.isArray(entry) &&
      entry.length >= 2 &&
      typeof entry[0] === "number" &&
      typeof entry[1] === "number"
    ) {
      spans.push([entry[0], entry[1]]);
    }
  }
  return spans;
}

/** Narrow an `unknown` to context lines, or `undefined` when absent / empty. */
function narrowContextLines(
  value: unknown,
): SearchResultContextLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines: SearchResultContextLine[] = [];
  for (const entry of value) {
    if (entry !== null && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      if (typeof e.line === "number" && typeof e.text === "string") {
        lines.push({ line: e.line, text: e.text });
      }
    }
  }
  return lines.length > 0 ? lines : undefined;
}

/** Narrow an `unknown` wire match to {@link SearchResultMatch}, or drop it. */
function narrowSearchResultMatch(value: unknown): SearchResultMatch | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.line !== "number" || typeof v.text !== "string") {
    return undefined;
  }
  return {
    line: v.line,
    text: v.text,
    spans: narrowSpans(v.spans),
    before: narrowContextLines(v.before),
    after: narrowContextLines(v.after),
  };
}

/** Narrow a wire file to {@link SearchResultFile}, or drop it (no `path`). */
function narrowSearchResultFile(file: GrepWireFile): SearchResultFile | undefined {
  if (file.path === undefined) return undefined;
  const matches = (file.matches ?? [])
    .map(narrowSearchResultMatch)
    .filter((m): m is SearchResultMatch => m !== undefined);
  return { path: file.path, matches };
}

/**
 * Decide which body kind a Grep result routes to. `files` present →
 * `"content"` (grouped matches → `SearchResultBlock`); else
 * `filenames` present → `"files"` (path list → `PathListBlock`); else
 * `undefined` (drift / streaming-incomplete — no body).
 */
export function composeGrepMode(
  structured: GrepStructuredResult,
): GrepBodyMode | undefined {
  if (structured.files !== undefined) return "content";
  if (structured.filenames !== undefined) return "files";
  return undefined;
}

/**
 * Compose the `SearchResultData` payload `SearchResultBlock` consumes.
 * Returns `undefined` when the structured event carries no `files`
 * array at all (drift / streaming / files-only mode) — an empty array
 * is a valid "no matches" result and still composes a (zero-file)
 * `SearchResultData`. `truncatedAt` is the producer's pre-truncation
 * file total (`numFiles`, falling back to the narrowed file count)
 * when `truncated` is set.
 */
export function composeGrepSearchData(
  structured: GrepStructuredResult,
): SearchResultData | undefined {
  const { files } = structured;
  if (files === undefined) return undefined;
  const narrowed = files
    .map(narrowSearchResultFile)
    .filter((f): f is SearchResultFile => f !== undefined);
  const truncatedAt =
    structured.truncated === true
      ? structured.numFiles ?? narrowed.length
      : undefined;
  return { files: narrowed, truncatedAt };
}

/**
 * Compose the `PathListData` payload `PathListBlock` consumes for
 * files-only mode. Mirrors `GlobToolBlock`'s `composeGlobPathListData`
 * — returns `undefined` only when the structured event carries no
 * `filenames` array at all.
 */
export function composeGrepPathListData(
  structured: GrepStructuredResult,
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
 * Compose the header match-count label, e.g. "12 matches" / "1 match".
 * Prefers the producer's `numMatches`; falls back to summing the
 * per-file match counts in content mode. Returns `undefined` when no
 * match count is knowable (files-only mode carries none).
 */
export function composeGrepMatchCountLabel(
  structured: GrepStructuredResult,
): string | undefined {
  let count = structured.numMatches;
  if (count === undefined && structured.files !== undefined) {
    count = structured.files.reduce(
      (sum, file) => sum + (file.matches?.length ?? 0),
      0,
    );
  }
  if (count === undefined) return undefined;
  return `${count.toLocaleString()} ${count === 1 ? "match" : "matches"}`;
}

/**
 * Compose the header file-count label, e.g. "3 files" / "1 file".
 * Prefers the producer's `numFiles`; falls back to the content-mode
 * `files` length, then the files-only `filenames` length. Returns
 * `undefined` when no file count is knowable.
 */
export function composeGrepFileCountLabel(
  structured: GrepStructuredResult,
): string | undefined {
  const count =
    structured.numFiles ??
    structured.files?.length ??
    structured.filenames?.length;
  if (count === undefined) return undefined;
  return `${count.toLocaleString()} ${count === 1 ? "file" : "files"}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GrepToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  structuredResult,
  textOutput,
  status,
  caution,
}) => {
  const grepInput = React.useMemo(() => narrowGrepInput(input), [input]);
  const structured = React.useMemo(
    () => narrowGrepStructured(structuredResult),
    [structuredResult],
  );
  const mode = React.useMemo(() => composeGrepMode(structured), [structured]);
  const searchData = React.useMemo(
    () => composeGrepSearchData(structured),
    [structured],
  );
  const pathListData = React.useMemo(
    () => composeGrepPathListData(structured),
    [structured],
  );
  const matchCountLabel = React.useMemo(
    () => composeGrepMatchCountLabel(structured),
    [structured],
  );
  const fileCountLabel = React.useMemo(
    () => composeGrepFileCountLabel(structured),
    [structured],
  );

  const pattern = grepInput.pattern;
  const argsSummary =
    pattern !== undefined ? (
      <span className="grep-tool-block-args">
        {/* `truncated` gates the tooltip on actual clipping — the
         * `<code>` is the ellipsizing element, so `TugTooltip`'s
         * scrollWidth-vs-clientWidth check measures it directly. */}
        <TugTooltip content={pattern} side="bottom" truncated>
          <code data-slot="grep-tool-block-pattern">{pattern}</code>
        </TugTooltip>
        {matchCountLabel !== undefined ? (
          <span
            data-slot="grep-tool-block-match-count"
            className="grep-tool-block-count"
          >
            {matchCountLabel}
          </span>
        ) : null}
        {fileCountLabel !== undefined ? (
          <span
            data-slot="grep-tool-block-file-count"
            className="grep-tool-block-count"
          >
            {fileCountLabel}
          </span>
        ) : null}
        {structured.truncated === true ? (
          <span
            data-slot="grep-tool-block-truncation"
            className="grep-tool-block-truncation"
          >
            truncated
          </span>
        ) : null}
      </span>
    ) : undefined;

  // Errored greps carry the failure message in `textOutput`; surface
  // it through the chrome's error band rather than the body.
  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="grep-tool-block-error-output">{textOutput}</span>
    ) : undefined;

  // Body: streaming → placeholder; error → none (the chrome's error
  // band is the primary content); ready → the embedded body kind the
  // result's mode selects. Content mode → SearchResultBlock;
  // files-only mode → PathListBlock (the same body kind GlobToolBlock
  // uses).
  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else if (status === "error") {
    body = null;
  } else if (mode === "content" && searchData !== undefined) {
    body = (
      <SearchResultBlock
        data={searchData}
        embedded
        className="grep-tool-block-results"
        componentStatePreservationKey={`${toolUseId}-body`}
      />
    );
  } else if (mode === "files" && pathListData !== undefined) {
    body = (
      <PathListBlock
        data={pathListData}
        embedded
        className="grep-tool-block-paths"
        componentStatePreservationKey={`${toolUseId}-body`}
      />
    );
  } else {
    body = null;
  }

  return (
    <ToolBlockChrome
      rootSlot="grep-tool-block"
      toolName={toolName}
      toolIcon={<Search size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolBlockChrome>
  );
};
