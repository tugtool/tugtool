/**
 * Code block rendering with Shiki syntax highlighting.
 *
 * Renders a DOM element for use by the vanilla conversation-card.ts.
 * The shared highlighter singleton and normalizeLanguage helper live in
 * code-block-utils.ts (also imported by the React CodeBlock component).
 */

import { type BundledLanguage } from "shiki";
import { createElement, Copy, Check } from "lucide";
import { getHighlighter, normalizeLanguage } from "./code-block-utils";

/**
 * Render a code block with Shiki syntax highlighting.
 * Returns an HTMLElement for direct DOM insertion.
 */
export async function renderCodeBlock(
  code: string,
  language: string
): Promise<HTMLElement> {
  const normalizedLang = normalizeLanguage(language);

  try {
    const highlighter = await getHighlighter();

    const loadedLanguages = highlighter.getLoadedLanguages();
    if (!loadedLanguages.includes(normalizedLang as BundledLanguage)) {
      try {
        await highlighter.loadLanguage(normalizedLang as BundledLanguage);
      } catch {
        return createFallbackBlock(code, language);
      }
    }

    const html = highlighter.codeToHtml(code, {
      lang: normalizedLang,
      theme: "github-dark",
    });

    return createContainer(code, language, html, false);
  } catch (error) {
    console.warn("Shiki highlighting failed, using fallback:", error);
    return createFallbackBlock(code, language);
  }
}

/**
 * Create a fallback code block without syntax highlighting.
 */
function createFallbackBlock(code: string, language: string): HTMLElement {
  const plainHtml = `<pre><code>${escapeHtml(code)}</code></pre>`;
  return createContainer(code, language, plainHtml, true);
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Create the code block container with header and copy button.
 */
function createContainer(
  code: string,
  language: string,
  codeHtml: string,
  isFallback: boolean
): HTMLElement {
  const container = document.createElement("div");
  container.className = "code-block-container";

  const header = document.createElement("div");
  header.className = "code-block-header";

  const languageLabel = document.createElement("span");
  languageLabel.className = "code-block-language";
  languageLabel.textContent = language || "text";

  const copyBtn = document.createElement("button");
  copyBtn.className = "code-block-copy-btn";
  copyBtn.type = "button";

  const copyIcon = createElement(Copy, { width: 14, height: 14 });
  copyBtn.appendChild(copyIcon);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);

      copyBtn.innerHTML = "";
      const checkIcon = createElement(Check, { width: 14, height: 14 });
      copyBtn.appendChild(checkIcon);
      copyBtn.classList.add("copied");

      setTimeout(() => {
        copyBtn.innerHTML = "";
        const newCopyIcon = createElement(Copy, { width: 14, height: 14 });
        copyBtn.appendChild(newCopyIcon);
        copyBtn.classList.remove("copied");
      }, 2000);
    } catch (error) {
      console.error("Failed to copy code:", error);
    }
  });

  header.appendChild(languageLabel);
  header.appendChild(copyBtn);

  const codeArea = document.createElement("div");
  codeArea.className = isFallback ? "code-block-fallback" : "code-block-code";
  codeArea.innerHTML = codeHtml;

  container.appendChild(header);
  container.appendChild(codeArea);

  return container;
}
