/**
 * paste-transforms.ts — pure text transforms for the "paste as quote"
 * and "paste as plain text" clipboard variants.
 *
 * Both transforms take the clipboard's plain-text payload and rewrite
 * it before it lands in an editing surface. They are framework-agnostic
 * (no React, no DOM) so the editor substrates (`tug-text-editor`, the
 * native-input responder) and tests can share one implementation.
 *
 *   - `quoteMarkdown` wraps the text as a GitHub-flavored blockquote —
 *     every line gains a `> ` prefix (blank lines become a bare `>`),
 *     preserving the source content verbatim.
 *   - `stripMarkdown` parses the text as Markdown and emits only its
 *     textual content: headings lose their `#`, emphasis/strong/strike
 *     unwrap, inline + fenced code unwrap, links collapse to their label,
 *     images to their alt text, list markers drop, raw HTML is removed.
 */

import { marked } from "marked";
import type { Token, Tokens } from "marked";

/**
 * Wrap `text` as a Markdown blockquote: prefix every line with `> `.
 * A blank line becomes a bare `>` so the quote block stays contiguous
 * rather than splitting into separate blockquotes at the blank line.
 * Returns the input unchanged when it is empty.
 */
export function quoteMarkdown(text: string): string {
  if (text === "") return text;
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

/**
 * Strip Markdown formatting from `text`, returning its plain-text
 * content. Parses with the same GFM lexer the renderer uses, then walks
 * the token tree extracting text. Block boundaries (paragraphs,
 * headings, code blocks, list items) are separated by a blank line;
 * inline formatting is unwrapped in place. Returns the input unchanged
 * when it is empty.
 */
export function stripMarkdown(text: string): string {
  if (text === "") return text;
  const tokens = marked.lexer(text);
  const out = blockTokensToText(tokens);
  // Collapse runs of 3+ newlines the join can produce around empty
  // blocks (e.g. an `hr` between paragraphs) down to one blank line,
  // and trim the trailing block separator.
  return out.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}

/** Join a list of block-level tokens, blank-line separated. */
function blockTokensToText(tokens: Token[]): string {
  const blocks: string[] = [];
  for (const token of tokens) {
    const rendered = blockTokenToText(token);
    if (rendered !== null) blocks.push(rendered);
  }
  return blocks.join("\n\n");
}

/** Render one block-level token to plain text, or `null` to drop it. */
function blockTokenToText(token: Token): string | null {
  switch (token.type) {
    case "heading":
    case "paragraph": {
      const t = token as Tokens.Heading | Tokens.Paragraph;
      return inlineTokensToText(t.tokens, t.text);
    }
    case "text": {
      const t = token as Tokens.Text;
      return inlineTokensToText(t.tokens, t.text);
    }
    case "blockquote": {
      const t = token as Tokens.Blockquote;
      return blockTokensToText(t.tokens);
    }
    case "code": {
      return (token as Tokens.Code).text;
    }
    case "list": {
      const t = token as Tokens.List;
      return t.items
        .map((item) => blockTokensToText(item.tokens).trim())
        .join("\n");
    }
    case "table": {
      const t = token as Tokens.Table;
      const rows = [
        t.header.map((cell) => inlineTokensToText(cell.tokens, cell.text)),
        ...t.rows.map((row) =>
          row.map((cell) => inlineTokensToText(cell.tokens, cell.text)),
        ),
      ];
      return rows.map((cells) => cells.join("\t")).join("\n");
    }
    // Structural-only tokens with no text payload.
    case "space":
    case "hr":
    case "html":
      return null;
    default: {
      // Defensive fallback for any token kind not enumerated above:
      // emit its raw text field if present, otherwise drop it.
      const t = token as { text?: unknown };
      return typeof t.text === "string" ? t.text : null;
    }
  }
}

/**
 * Render inline tokens to plain text. `fallback` is the token's own
 * `text` field, used when a token carries no parsed inline children.
 */
function inlineTokensToText(
  tokens: Token[] | undefined,
  fallback: string,
): string {
  if (!tokens || tokens.length === 0) return fallback;
  return tokens.map(inlineTokenToText).join("");
}

/** Render one inline token to plain text. */
function inlineTokenToText(token: Token): string {
  switch (token.type) {
    case "text":
    case "strong":
    case "em":
    case "del": {
      const t = token as Tokens.Text | Tokens.Strong | Tokens.Em | Tokens.Del;
      return inlineTokensToText(t.tokens, t.text);
    }
    case "link": {
      const t = token as Tokens.Link;
      return inlineTokensToText(t.tokens, t.text);
    }
    case "image":
      return (token as Tokens.Image).text;
    case "codespan":
      return (token as Tokens.Codespan).text;
    case "escape":
      return (token as Tokens.Escape).text;
    case "br":
      return "\n";
    // Drop raw inline HTML entirely.
    case "html":
      return "";
    default: {
      const t = token as { text?: unknown };
      return typeof t.text === "string" ? t.text : "";
    }
  }
}
