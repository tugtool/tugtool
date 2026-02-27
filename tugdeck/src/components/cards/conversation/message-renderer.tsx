/**
 * MessageRenderer — React component that renders Markdown content as safe HTML.
 *
 * Uses renderMarkdown() from src/lib/markdown.ts (which applies marked + DOMPurify)
 * and sets the result via dangerouslySetInnerHTML.  Streaming messages pass
 * isStreaming=true to show a blinking cursor appended after the prose block.
 *
 * References: [D03] React content only, [D05] DOMPurify, Step 8.1
 */

import { useEffect, useRef } from "react";
import { renderMarkdown } from "../../../lib/markdown";

// ---- Props ----

export interface MessageRendererProps {
  /** Raw markdown text to render */
  text: string;
  /** When true, shows a streaming cursor at the end of content */
  isStreaming?: boolean;
}

// ---- Component ----

export function MessageRenderer({ text, isStreaming = false }: MessageRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const html = renderMarkdown(text);

  // After rendering, enhance code blocks with Shiki asynchronously.
  // We use a ref-based effect so we don't block the render pipeline.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    import("../../../lib/markdown").then(({ enhanceCodeBlocks }) => {
      if (!cancelled && containerRef.current) {
        enhanceCodeBlocks(containerRef.current).catch((err) => {
          console.error("MessageRenderer: failed to enhance code blocks", err);
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [text]);

  return (
    <div ref={containerRef} className="message-renderer">
      {/* Rendered markdown via dangerouslySetInnerHTML — content is DOMPurify-sanitized */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {isStreaming && (
        <span
          className="streaming-cursor"
          aria-hidden="true"
          data-testid="streaming-cursor"
        />
      )}
    </div>
  );
}
