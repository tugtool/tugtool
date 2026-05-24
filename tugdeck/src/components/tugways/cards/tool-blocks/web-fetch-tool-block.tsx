/**
 * `WebFetchToolBlock` — Layer-2 wrapper for the `WebFetch` tool.
 *
 * `WebFetch` takes `{ url, prompt }`, fetches the URL, converts HTML →
 * markdown, runs the supplied prompt against the converted content,
 * and returns the model's response (typically a few paragraphs of
 * markdown). The user's reading attention is anchored on two things:
 * (a) *which* URL was fetched (so they can verify the right page was
 * read), and (b) *what came back* (the summary the model produced).
 *
 * Composition (per [Spec S03] / [Table T02] / [#bk-conformance]):
 *
 *  - **Header** — a `Globe` icon + `WebFetch` + the URL in the args
 *    slot. The URL ellipsizes via `MiddleEllipsisPath` — middle
 *    ellipsis is exactly right for URLs (the host + tail-of-path are
 *    the recognisable bits; the middle of a long path is sacrificial).
 *    A small `cached` chip surfaces when the result text begins with
 *    the Claude Code cache-hit prefix (a 15-minute self-cleaning cache
 *    serves the same URL → same prompt twice — surfacing the chip
 *    lets the user know they're looking at a recycled answer).
 *
 *  - **Body** — embedded `TugMarkdownBlock` over the result text. The
 *    result is markdown by design (the tool returns markdown summaries
 *    of HTML pages), so rendering it as markdown rather than as plain
 *    text matches the producer's intent. The prompt also rides the
 *    body as a `prompt:` field row above the markdown — the user
 *    asked the model to do something specific, and seeing the prompt
 *    alongside the answer is the load-bearing context.
 *
 *  - **Chrome-level fold + copy** — default FOLDED. The fetched
 *    summary is what Claude Code's WebFetch produced *for the model*;
 *    the assistant's surrounding prose typically restates the same
 *    bullets. Folding by default lets the prose lead and keeps the
 *    verbatim summary one click away as evidence. Matches the
 *    TaskMgmt precedent ([#step-24-3-3]) for blocks the assistant
 *    fully restates. Copy collects the raw markdown so a teammate
 *    can paste it elsewhere with formatting intact.
 *
 * Streaming / error ([Spec S03]):
 *
 *  - `status === "streaming"` → header still shows whatever input
 *    fragment has arrived; body is `<StreamingPlaceholder />`.
 *  - `status === "error"` → chrome paints the error band from the
 *    plain-text `tool_result.output` (typically the fetch failure —
 *    `ENOTFOUND`, `403`, an SSL chain error); body is dropped so the
 *    failure reads as the primary content.
 *  - `status === "ready"` → steady-state markdown render.
 *
 * Wire shape (`input` and `textOutput`):
 *
 *  - `input`: `{ url: string, prompt: string }`. Both narrowed
 *    defensively.
 *  - `textOutput`: the markdown result (consumed verbatim). No
 *    structured-result shape today — the tool returns a single
 *    markdown string.
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM
 *    attributes; body composition is pure props.
 *  - [L19] file pair (`.tsx` + `.css`),
 *    `data-slot="web-fetch-tool-block"` (delegated to chrome via
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and
 *    `TugMarkdownBlock`'s `--tugx-md-*`; no new tokens. The cached
 *    chip rides the chrome's caution-badge metrics.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — `TugMarkdownBlock` owns markdown render;
 *    the wrapper owns chrome + the URL / prompt context.
 *  - [D101] visibility policy — `webfetch` moves from `default-intent`
 *    to bespoke in this change; the policy entry is removed in the
 *    same commit.
 *
 * @module components/tugways/cards/tool-blocks/web-fetch-tool-block
 */

import "./web-fetch-tool-block.css";

import React from "react";
import { Globe } from "lucide-react";

import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";

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

/** `WebFetch` tool input — the wire fields under `tool_use.input`. */
export interface WebFetchInput {
  url?: string;
  prompt?: string;
}

/**
 * Narrow the wrapper-side `unknown` input. Defensive: returns `{}` for
 * non-object inputs, drops mistyped fields silently.
 */
export function narrowWebFetchInput(value: unknown): WebFetchInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    url: typeof v.url === "string" ? v.url : undefined,
    prompt: typeof v.prompt === "string" ? v.prompt : undefined,
  };
}

// ---------------------------------------------------------------------------
// Cache-hit detection — the WebFetch tool exposes a 15-minute
// self-cleaning cache; a cache hit is signalled by a prefix on the
// result text. Surface it as a small `cached` chip so the user knows
// they're reading a recycled summary.
// ---------------------------------------------------------------------------

const CACHE_HIT_PREFIX = "[Cached]";

/**
 * `true` when the `textOutput` carries the cache-hit prefix the
 * Claude Code WebFetch tool emits for repeated `(url, prompt)` pairs.
 * Pure and exported for tests.
 */
export function detectCacheHit(textOutput: string | undefined): boolean {
  if (textOutput === undefined) return false;
  const trimmed = textOutput.trimStart();
  return trimmed.startsWith(CACHE_HIT_PREFIX);
}

/**
 * Strip the `[Cached]` prefix (plus any leading whitespace) from the
 * markdown result so it doesn't bleed into the body. When no prefix
 * is present, returns the input unchanged. When the input is empty /
 * undefined, returns empty string.
 */
export function stripCacheHitPrefix(textOutput: string | undefined): string {
  if (textOutput === undefined) return "";
  const trimmed = textOutput.trimStart();
  if (!trimmed.startsWith(CACHE_HIT_PREFIX)) return textOutput;
  return trimmed.slice(CACHE_HIT_PREFIX.length).trimStart();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WebFetchToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  textOutput,
  status,
  caution,
}) => {
  const fetchInput = React.useMemo(() => narrowWebFetchInput(input), [input]);
  const cached = React.useMemo(() => detectCacheHit(textOutput), [textOutput]);
  const markdownText = React.useMemo(
    () => stripCacheHitPrefix(textOutput),
    [textOutput],
  );

  const url = fetchInput.url;
  const argsSummary =
    url !== undefined ? (
      <span className="web-fetch-tool-block-args">
        <MiddleEllipsisPath path={url} />
        {cached ? (
          <span
            data-slot="web-fetch-tool-block-cached"
            className="web-fetch-tool-block-cached"
          >
            cached
          </span>
        ) : null}
      </span>
    ) : undefined;

  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <ToolBlockPre>{textOutput}</ToolBlockPre>
    ) : undefined;

  const hasPrompt =
    fetchInput.prompt !== undefined && fetchInput.prompt.length > 0;
  const hasMarkdown = markdownText.length > 0;

  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else if (status === "error") {
    body = null;
  } else if (hasPrompt || hasMarkdown) {
    body = (
      <ToolBlockBody>
        {hasPrompt ? (
          <ToolBlockFieldRow label="prompt" layout="stacked">
            <ToolBlockPre>{fetchInput.prompt}</ToolBlockPre>
          </ToolBlockFieldRow>
        ) : null}
        {hasMarkdown ? (
          <TugMarkdownBlock
            initialText={markdownText}
            className="web-fetch-tool-block-markdown"
            // Mount-once: `TugMarkdownBlock`'s `initialText` mode is a
            // mount-once contract. A `WebFetch` result is delivered as
            // a single complete markdown string when the tool completes
            // — there is no second render with a longer payload — so
            // the mount-once render matches the producer's behaviour.
            // If a future protocol streams the markdown, swap to
            // `streamingStore` mode.
            key={toolUseId}
          />
        ) : null}
      </ToolBlockBody>
    );
  } else {
    body = null;
  }

  // Default-FOLDED — WebFetch is summary-shaped: the result IS the
  // model-readable rendering of the fetched page, and the assistant's
  // surrounding prose typically restates the same bullets. Folding by
  // default lets the prose lead and keeps the verbatim summary one
  // click away as evidence. Matches the TaskMgmt precedent ([#step-24-3-3])
  // for tool blocks whose body is fully restated by the model.
  // Copy collects the raw markdown so the user can paste it elsewhere
  // with formatting intact (the [Cached] prefix is stripped).
  const hasBody = body !== null && status === "ready";
  const fold = hasBody
    ? {
        defaultFolded: true,
        preservationKey: `web-fetch-tool-block/${toolUseId}/fold`,
        collapsedLabel: "summary",
      }
    : undefined;
  const copyText = hasMarkdown ? markdownText : undefined;

  return (
    <ToolBlockChrome
      rootSlot="web-fetch-tool-block"
      toolName={toolName}
      toolIcon={<Globe size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
      fold={fold}
      copyText={copyText}
    >
      {body}
    </ToolBlockChrome>
  );
};
