/**
 * file-completion-provider.ts — File completion provider stub for the @ trigger.
 *
 * Provides a factory that creates a CompletionProvider from a list of file paths.
 * The provider filters files by case-insensitive substring match and returns up to
 * 8 results as CompletionItem[] with atom.type = "file".
 *
 * Extracted from galleryFileCompletionProvider in gallery-prompt-input.tsx.
 * The filtering behavior and CompletionItem format are identical.
 *
 * [L06] Completion providers drive direct DOM updates via the engine, not React re-renders.
 * [L07] Providers are stable refs created once per scope.
 */

import type { CompletionItem, CompletionProvider } from "./tug-text-engine";

/**
 * Creates a CompletionProvider for the @ trigger that filters the given file list
 * by case-insensitive substring match on the query string.
 *
 * Returns up to 8 matching CompletionItems with atom.type = "file".
 * When query is empty, returns the first 8 files unfiltered.
 */
export function createFileCompletionProvider(files: string[]): CompletionProvider {
  return (query: string): CompletionItem[] => {
    const q = query.toLowerCase();
    const matched =
      q.length === 0
        ? files.slice(0, 8)
        : files.filter(f => f.toLowerCase().includes(q)).slice(0, 8);
    return matched.map(f => ({
      label: f,
      atom: { kind: "atom" as const, type: "file", label: f, value: f },
    }));
  };
}
