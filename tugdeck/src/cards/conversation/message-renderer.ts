/**
 * Markdown rendering pipeline with DOMPurify sanitization.
 *
 * This file now re-exports the framework-agnostic utilities from
 * src/lib/markdown.ts.  Existing imports of renderMarkdown, SANITIZE_CONFIG,
 * and enhanceCodeBlocks from this path remain valid.
 *
 * Vanilla conversation-card.ts imports these functions from here.
 * React components import from src/lib/markdown.ts directly.
 */

export { renderMarkdown, SANITIZE_CONFIG, enhanceCodeBlocks } from "../../lib/markdown";
