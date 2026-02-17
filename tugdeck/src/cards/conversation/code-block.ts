/**
 * Code block rendering with Shiki syntax highlighting
 */

import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";
import { createElement, Copy, Check } from "lucide";

// Singleton highlighter instance
let highlighterPromise: Promise<Highlighter> | null = null;

// 17 initial languages per D06
const INITIAL_LANGUAGES: BundledLanguage[] = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "shellscript", // Bash/Shell
  "json",
  "css",
  "html",
  "markdown",
  "go",
  "java",
  "c",
  "cpp",
  "sql",
  "yaml",
  "toml",
  "dockerfile",
];

/**
 * Get or initialize the Shiki highlighter
 */
async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: INITIAL_LANGUAGES,
    });
  }
  return highlighterPromise;
}

/**
 * Normalize language identifier
 */
function normalizeLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim();
  
  // Common aliases
  if (normalized === "bash" || normalized === "sh" || normalized === "shell") {
    return "shellscript";
  }
  if (normalized === "c++" || normalized === "cxx") {
    return "cpp";
  }
  if (normalized === "js") {
    return "javascript";
  }
  if (normalized === "ts") {
    return "typescript";
  }
  if (normalized === "py") {
    return "python";
  }
  if (normalized === "rs") {
    return "rust";
  }
  
  return normalized;
}

/**
 * Render a code block with Shiki syntax highlighting
 */
export async function renderCodeBlock(
  code: string,
  language: string
): Promise<HTMLElement> {
  const normalizedLang = normalizeLanguage(language);
  
  try {
    const highlighter = await getHighlighter();
    
    // Check if language is loaded
    const loadedLanguages = highlighter.getLoadedLanguages();
    let langToUse = normalizedLang;
    
    if (!loadedLanguages.includes(normalizedLang as BundledLanguage)) {
      // Try to load it dynamically
      try {
        await highlighter.loadLanguage(normalizedLang as BundledLanguage);
      } catch {
        // Language not available, fall back to plain text
        return createFallbackBlock(code, language);
      }
    }
    
    // Generate syntax-highlighted HTML
    const html = highlighter.codeToHtml(code, {
      lang: langToUse,
      theme: "github-dark",
    });
    
    // Build container
    return createContainer(code, language, html, false);
  } catch (error) {
    console.warn("Shiki highlighting failed, using fallback:", error);
    return createFallbackBlock(code, language);
  }
}

/**
 * Create a fallback code block without syntax highlighting
 */
function createFallbackBlock(code: string, language: string): HTMLElement {
  const plainHtml = `<pre><code>${escapeHtml(code)}</code></pre>`;
  return createContainer(code, language, plainHtml, true);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Create the code block container with header and copy button
 */
function createContainer(
  code: string,
  language: string,
  codeHtml: string,
  isFallback: boolean
): HTMLElement {
  const container = document.createElement("div");
  container.className = "code-block-container";
  
  // Header with language label and copy button
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
  
  // Copy button click handler
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      
      // Replace icon with check mark
      copyBtn.innerHTML = "";
      const checkIcon = createElement(Check, { width: 14, height: 14 });
      copyBtn.appendChild(checkIcon);
      copyBtn.classList.add("copied");
      
      // Restore after 2 seconds
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
  
  // Code area
  const codeArea = document.createElement("div");
  codeArea.className = isFallback ? "code-block-fallback" : "code-block-code";
  codeArea.innerHTML = codeHtml;
  
  container.appendChild(header);
  container.appendChild(codeArea);
  
  return container;
}
