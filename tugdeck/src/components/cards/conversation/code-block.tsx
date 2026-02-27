/**
 * CodeBlock — React component wrapping Shiki syntax highlighting with a
 * copy-to-clipboard button.
 *
 * Accepts raw code and a language string, renders syntax-highlighted HTML
 * asynchronously, and shows a shadcn Button for clipboard copy with a
 * transient check-mark confirmation.
 *
 * Falls back to plain <pre><code> when Shiki is unavailable or the language
 * is not supported.
 *
 * References: [D03] React content only, Step 8.1
 */

import { useState, useEffect } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeLanguage, getHighlighter } from "../../../cards/conversation/code-block-utils";

// ---- Props ----

export interface CodeBlockProps {
  /** Raw source code to display */
  code: string;
  /** Language identifier (e.g. "typescript", "bash", "python") */
  language: string;
}

// ---- Component ----

export function CodeBlock({ code, language }: CodeBlockProps) {
  const normalizedLang = normalizeLanguage(language);

  // Highlighted HTML produced by Shiki (null while loading, "" on fallback)
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      try {
        const highlighter = await getHighlighter();
        const loaded = highlighter.getLoadedLanguages();

        if (!(loaded as string[]).includes(normalizedLang)) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (highlighter as any).loadLanguage(normalizedLang);
          } catch {
            // Language not available — fall back to plain text
            if (!cancelled) setHighlightedHtml("");
            return;
          }
        }

        const html = highlighter.codeToHtml(code, {
          lang: normalizedLang,
          theme: "github-dark",
        });

        if (!cancelled) setHighlightedHtml(html);
      } catch {
        if (!cancelled) setHighlightedHtml("");
      }
    }

    highlight();

    return () => {
      cancelled = true;
    };
  }, [code, normalizedLang]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("CodeBlock: copy failed", err);
    }
  }

  const displayLang = language || "text";

  return (
    <div className="code-block-container" data-testid="code-block">
      {/* Header: language label + copy button */}
      <div className="code-block-header flex items-center justify-between px-3 py-1.5">
        <span className="code-block-language text-xs text-muted-foreground">
          {displayLang}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="code-block-copy-btn h-7 px-2"
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          data-testid="copy-button"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </Button>
      </div>

      {/* Code area */}
      {highlightedHtml === null ? (
        // Loading state: show plain pre while Shiki initialises
        <pre className="code-block-fallback overflow-auto p-3 text-sm">
          <code>{code}</code>
        </pre>
      ) : highlightedHtml === "" ? (
        // Fallback: Shiki unavailable for this language
        <pre className="code-block-fallback overflow-auto p-3 text-sm">
          <code>{code}</code>
        </pre>
      ) : (
        // Shiki-highlighted HTML
        <div
          className="code-block-code"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      )}
    </div>
  );
}
