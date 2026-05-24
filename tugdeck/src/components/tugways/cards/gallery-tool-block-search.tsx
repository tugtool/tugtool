/**
 * gallery-tool-block-search.tsx — visual fixture for
 * `WebSearchToolBlock`.
 *
 * Variants:
 *  1. **Parsed results** — markdown-formatted result text the parser
 *     recognises; per-result `TugLink` + URL + snippet rows.
 *  2. **Markdown fallback** — result text that doesn't parse into
 *     entries; the body falls back to `TugMarkdownBlock`.
 *  3. **Domain-filtered** — the `allowed_domains` input field surfaces
 *     as a body row.
 *  4. **Empty** — query with no matches; the body just shows the
 *     header chips.
 *
 * @module components/tugways/cards/gallery-tool-block-search
 */

import React from "react";

import { WebSearchToolBlock } from "./tool-blocks/web-search-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARSED_RESULTS: ToolBlockProps = {
  toolUseId: "websearch-1",
  toolName: "WebSearch",
  msgId: "gallery-msg",
  seq: 0,
  input: { query: "react 19 release notes" },
  textOutput: [
    "- [React 19 — official release](https://react.dev/blog/2024/04/25/react-19) — actions, the `use` API, and server components.",
    "- [React Conf 2024 recap](https://react.dev/conf) — talks covering the new release.",
    "- [What's new in React 19](https://example.com/react-19) — third-party walkthrough with code samples.",
    "- [React 19 migration guide](https://example.com/migration) — upgrading from 18 to 19.",
  ].join("\n"),
  isError: false,
  status: "ready",
};

const MARKDOWN_FALLBACK: ToolBlockProps = {
  toolUseId: "websearch-2",
  toolName: "WebSearch",
  msgId: "gallery-msg",
  seq: 1,
  input: { query: "claude code documentation" },
  textOutput: [
    "I found a mix of resources for **Claude Code**:",
    "",
    "Anthropic publishes setup and usage guides on their docs site. The official",
    "CLI ships through `npm install -g @anthropic-ai/claude-code`, and there are",
    "video walkthroughs on YouTube covering plugin authoring.",
  ].join("\n"),
  isError: false,
  status: "ready",
};

const DOMAIN_FILTERED: ToolBlockProps = {
  toolUseId: "websearch-3",
  toolName: "WebSearch",
  msgId: "gallery-msg",
  seq: 2,
  input: {
    query: "rust async traits",
    allowed_domains: ["doc.rust-lang.org", "rust-lang.github.io"],
  },
  textOutput: [
    "- [Async fn in traits](https://doc.rust-lang.org/std/keyword.async.html) — stable as of Rust 1.75.",
    "- [Rust async book](https://rust-lang.github.io/async-book/) — comprehensive guide.",
  ].join("\n"),
  isError: false,
  status: "ready",
};

const EMPTY_RESULTS: ToolBlockProps = {
  toolUseId: "websearch-4",
  toolName: "WebSearch",
  msgId: "gallery-msg",
  seq: 3,
  input: { query: "totally-unique-query-string-xyz-12345" },
  textOutput: "No results found for that query.",
  isError: false,
  status: "ready",
};

// ---------------------------------------------------------------------------
// GalleryToolBlockSearch
// ---------------------------------------------------------------------------

export function GalleryToolBlockSearch(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-tool-block-search">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          WebSearch — parsed results (TugLink + URL + snippet rows)
        </TugLabel>
        <WebSearchToolBlock {...PARSED_RESULTS} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          WebSearch — markdown fallback (no parseable links → TugMarkdownBlock)
        </TugLabel>
        <WebSearchToolBlock {...MARKDOWN_FALLBACK} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          WebSearch — domain-filtered (allowed_domains row + results)
        </TugLabel>
        <WebSearchToolBlock {...DOMAIN_FILTERED} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          WebSearch — empty (header chips only, body is the fallback)
        </TugLabel>
        <WebSearchToolBlock {...EMPTY_RESULTS} />
      </div>
    </div>
  );
}
