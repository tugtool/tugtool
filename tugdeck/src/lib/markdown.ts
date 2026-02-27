/**
 * Pure TypeScript markdown rendering utilities.
 *
 * Extracted from vanilla message-renderer.ts so these framework-agnostic
 * functions can be imported by both the React MessageRenderer component
 * (src/components/cards/conversation/message-renderer.tsx) and tests.
 *
 * After Step 10 vanilla deletion, enhanceCodeBlocks uses code-block-utils
 * directly (vanilla code-block.ts is gone).
 *
 * DOMPurify initialization strategy:
 * - Browser (Vite build): use the native window.
 * - Bun/Node test environment: use a jsdom Window.  happy-dom's DOM
 *   tree-mutation behaviour diverges from the spec in ways that cause
 *   DOMPurify's ALLOWED_TAGS + FORBID_TAGS interaction to silently pass
 *   nested forbidden elements (e.g. <script> nested inside a non-allowed
 *   <div>).  jsdom is already a devDependency, so this adds no new deps.
 */

import { marked } from "marked";
import DOMPurifyModule from "dompurify";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dompurify: ReturnType<typeof DOMPurifyModule> | null = null;

/**
 * Return a DOMPurify instance backed by a standards-compliant DOM.
 *
 * In a real browser the native window is used.
 * In Bun/Node test environments a jsdom Window is created so DOMPurify's
 * tree-mutation logic works correctly (happy-dom has known spec divergences).
 */
function getDOMPurify(): ReturnType<typeof DOMPurifyModule> {
  if (_dompurify && _dompurify.isSupported) return _dompurify;

  // In Bun/Node environments use jsdom for a standards-compliant DOM.
  // typeof Bun is a reliable Bun-runtime discriminator; typeof process is Node.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isBunOrNode = typeof (globalThis as any).Bun !== "undefined"
    || (typeof process !== "undefined" && process.versions != null && !process.versions.bun && process.versions.node != null);

  if (isBunOrNode) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { JSDOM } = require("jsdom") as typeof import("jsdom");
      const dom = new JSDOM("<!DOCTYPE html>");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _dompurify = DOMPurifyModule(dom.window as any);
      if (_dompurify.isSupported) return _dompurify;
    } catch {
      // jsdom not available — fall through to window fallback
    }
  }

  // Browser or fallback: use the current window.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win: any = typeof window !== "undefined" ? window : (global as any).window;
  _dompurify = DOMPurifyModule(win);
  return _dompurify;
}

/**
 * Render Markdown to safe HTML.
 * Returns a string with a wrapping .conversation-prose div.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  const clean = getDOMPurify().sanitize(html, SANITIZE_CONFIG);
  return `<div class="conversation-prose">${clean}</div>`;
}

/**
 * Enhance code blocks with Shiki syntax highlighting.
 * Finds all pre > code elements and replaces them with enhanced blocks.
 * Used by the React MessageRenderer component (src/components/cards/conversation/).
 *
 * Builds a .code-block-container DOM node directly using code-block-utils
 * (the vanilla code-block.ts was deleted in Step 10).
 */
export async function enhanceCodeBlocks(container: HTMLElement): Promise<void> {
  const { getHighlighter, normalizeLanguage } = await import(
    "../cards/conversation/code-block-utils"
  );

  const codeElements = container.querySelectorAll("pre > code");
  for (const codeEl of Array.from(codeElements)) {
    const preEl = codeEl.parentElement;
    if (!preEl) continue;

    const classList = Array.from(codeEl.classList);
    const langClass = classList.find((cls) => cls.startsWith("language-"));
    const rawLang = langClass ? langClass.replace("language-", "") : "text";
    const language = normalizeLanguage(rawLang);
    const code = codeEl.textContent || "";

    try {
      const highlighter = await getHighlighter();

      // Load the language dynamically if not already loaded
      const loaded = highlighter.getLoadedLanguages() as string[];
      if (!loaded.includes(language)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (highlighter as any).loadLanguage(language);
        } catch {
          // Language not available — fall back to plain display
        }
      }

      const html = highlighter.codeToHtml(code, {
        lang: loaded.includes(language) ? language : "text",
        theme: "github-dark",
      });

      // Build .code-block-container element to replace the raw <pre>
      const blockEl = document.createElement("div");
      blockEl.className = "code-block-container";

      const headerEl = document.createElement("div");
      headerEl.className = "code-block-header";

      const langEl = document.createElement("span");
      langEl.className = "code-block-language";
      langEl.textContent = rawLang;
      headerEl.appendChild(langEl);

      const codeWrap = document.createElement("div");
      codeWrap.className = "code-block-code";
      codeWrap.innerHTML = html;

      blockEl.appendChild(headerEl);
      blockEl.appendChild(codeWrap);

      preEl.replaceWith(blockEl);
    } catch (error) {
      console.error("Failed to enhance code block:", error);
    }
  }
}
