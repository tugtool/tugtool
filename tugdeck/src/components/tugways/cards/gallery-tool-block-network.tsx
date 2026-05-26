/**
 * gallery-tool-block-network.tsx — visual fixture for
 * `WebFetchToolBlock`.
 *
 * Stacked variants covering the load-bearing readings:
 *
 *  1. **Cache miss (fresh fetch)** — full markdown summary in the
 *     body; no `cached` chip in the header.
 *  2. **Cache hit** — result text begins with `[Cached]`; the wrapper
 *     strips the prefix from the body and surfaces a `cached` chip
 *     in the header.
 *  3. **Streaming** — input has the URL; body is the streaming
 *     placeholder.
 *  4. **Fetch error** — `status: "error"`; chrome paints the error
 *     band, body is dropped.
 *
 * @module components/tugways/cards/gallery-tool-block-network
 */

import React from "react";

import { WebFetchToolBlock } from "./tool-blocks/web-fetch-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRESH_FETCH: ToolBlockProps = {
  toolUseId: "webfetch-1",
  toolName: "WebFetch",
  seq: 0,
  input: {
    url: "https://www.anthropic.com",
    prompt: "Summarize the homepage in three bullets.",
  },
  textOutput: [
    "## Anthropic — homepage summary",
    "",
    "- Anthropic is an AI safety company building reliable, interpretable systems.",
    "- The site frontlines **Claude**, their flagship assistant, with sections for the API, Claude.ai, and research.",
    "- A careers banner sits in the navigation, signaling active hiring.",
  ].join("\n"),
  isError: false,
  status: "ready",
};

const CACHE_HIT: ToolBlockProps = {
  toolUseId: "webfetch-2",
  toolName: "WebFetch",
  seq: 1,
  input: {
    url: "https://react.dev/blog/2024/04/25/react-19",
    prompt: "What's new in React 19?",
  },
  textOutput: [
    "[Cached] ## React 19 — what's new",
    "",
    "- **Actions** — the new `action` prop on forms; the `useActionState` hook.",
    "- **`use` API** — read promises during render with automatic suspense.",
    "- **Server Components** — first-class support in the framework.",
  ].join("\n"),
  isError: false,
  status: "ready",
};

const STREAMING: ToolBlockProps = {
  toolUseId: "webfetch-3",
  toolName: "WebFetch",
  seq: 2,
  input: { url: "https://example.com/long-running" },
  status: "streaming",
};

const FETCH_ERROR: ToolBlockProps = {
  toolUseId: "webfetch-4",
  toolName: "WebFetch",
  seq: 3,
  input: {
    url: "https://nonexistent.example",
    prompt: "Summarize",
  },
  textOutput:
    "getaddrinfo ENOTFOUND nonexistent.example — fetch failed before reading any bytes",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryToolBlockNetwork
// ---------------------------------------------------------------------------

export function GalleryToolBlockNetwork(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-tool-block-network">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          WebFetch — fresh fetch (markdown summary body, no cached chip)
        </TugLabel>
        <WebFetchToolBlock {...FRESH_FETCH} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          WebFetch — cache hit ([Cached] prefix → `cached` chip; body
          strips the prefix)
        </TugLabel>
        <WebFetchToolBlock {...CACHE_HIT} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          WebFetch — streaming (in-flight placeholder)
        </TugLabel>
        <WebFetchToolBlock {...STREAMING} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          WebFetch — fetch error (chrome error band; body dropped)
        </TugLabel>
        <WebFetchToolBlock {...FETCH_ERROR} />
      </div>
    </div>
  );
}
