/**
 * Pure TypeScript markdown rendering utilities.
 *
 * Extracted from vanilla message-renderer.ts so these framework-agnostic
 * functions can be imported by both the React MessageRenderer component
 * (src/components/cards/conversation/message-renderer.tsx) and existing
 * tests (e.g. e2e-integration.test.ts).
 *
 * The vanilla message-renderer.ts re-exports from this file so existing
 * imports remain valid.
 */

import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

// Configure marked with GitHub-Flavored Markdown
marked.setOptions({
  gfm: true,
  breaks: true,
});

// DOMPurify configuration per D05
export const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "strong", "em", "del", "sup", "sub",
    "a", "code", "pre",
    "ul", "ol", "li",
    "blockquote",
    "table", "thead", "tbody", "tr", "th", "td",
    "img",
  ],
  ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "id"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style", "link", "meta", "base", "svg", "math"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
};

/**
 * Render Markdown to safe HTML.
 * Returns a string with a wrapping .conversation-prose div.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  const clean = DOMPurify.sanitize(html, SANITIZE_CONFIG);
  return `<div class="conversation-prose">${clean}</div>`;
}

/**
 * Enhance code blocks with Shiki syntax highlighting.
 * Finds all pre > code elements and replaces them with enhanced blocks.
 * Used by both the vanilla conversation-card.ts (via message-renderer.ts re-export)
 * and the React MessageRenderer component.
 */
export async function enhanceCodeBlocks(container: HTMLElement): Promise<void> {
  const { renderCodeBlock } = await import("../cards/conversation/code-block");

  const codeElements = container.querySelectorAll("pre > code");
  for (const codeEl of Array.from(codeElements)) {
    const preEl = codeEl.parentElement;
    if (!preEl) continue;

    const classList = Array.from(codeEl.classList);
    const langClass = classList.find((cls) => cls.startsWith("language-"));
    const language = langClass ? langClass.replace("language-", "") : "text";
    const code = codeEl.textContent || "";

    try {
      const enhancedBlock = await renderCodeBlock(code, language);
      preEl.replaceWith(enhancedBlock);
    } catch (error) {
      console.error("Failed to enhance code block:", error);
    }
  }
}
