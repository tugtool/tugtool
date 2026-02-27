/**
 * Shared utilities for Shiki-based code highlighting.
 *
 * Extracted from code-block.ts so the React CodeBlock component can share the
 * singleton highlighter and language-normalisation logic without creating a
 * second highlighter instance.
 *
 * The vanilla code-block.ts re-exports from here; existing imports remain valid.
 */

import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

// 17 initial languages per D06
export const INITIAL_LANGUAGES: BundledLanguage[] = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "shellscript",
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

// Singleton highlighter promise shared across vanilla and React code paths
let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Get (or lazily initialise) the Shiki highlighter singleton.
 */
export async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: INITIAL_LANGUAGES,
    });
  }
  return highlighterPromise;
}

/**
 * Normalise a language identifier to a Shiki-compatible form.
 */
export function normalizeLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim();

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
