/**
 * Markdown rendering pipeline with DOMPurify sanitization
 */

import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import { renderCodeBlock } from "./code-block";

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
 * Render Markdown to safe HTML
 */
export function renderMarkdown(text: string): string {
  // Parse Markdown
  const html = marked.parse(text, { async: false }) as string;

  // Sanitize with DOMPurify
  const clean = DOMPurify.sanitize(html, SANITIZE_CONFIG);

  // Wrap in conversation-prose container
  return `<div class="conversation-prose">${clean}</div>`;
}

/**
 * Enhance code blocks with Shiki syntax highlighting
 * Finds all pre > code elements and replaces them with enhanced code blocks
 */
export async function enhanceCodeBlocks(container: HTMLElement): Promise<void> {
  const codeElements = container.querySelectorAll("pre > code");

  for (const codeEl of Array.from(codeElements)) {
    const preEl = codeEl.parentElement;
    if (!preEl) continue;

    // Extract language from class (marked adds language-* classes)
    const classList = Array.from(codeEl.classList);
    const langClass = classList.find(cls => cls.startsWith("language-"));
    const language = langClass ? langClass.replace("language-", "") : "text";

    // Extract code content
    const code = codeEl.textContent || "";

    try {
      // Render enhanced code block
      const enhancedBlock = await renderCodeBlock(code, language);

      // Replace the pre element with enhanced block
      preEl.replaceWith(enhancedBlock);
    } catch (error) {
      console.error("Failed to enhance code block:", error);
      // Leave original block in place on error
    }
  }
}
