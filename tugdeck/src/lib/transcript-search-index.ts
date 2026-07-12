/**
 * transcript-search-index — the query-independent store→text index behind the
 * Dev card's Find route.
 *
 * The transcript is a virtualized list: almost every row is unmounted at any
 * moment (`OVERSCAN_COUNT = 3`), so a whole-transcript match count cannot come
 * from the DOM. This module projects **every** data-source row to a plain-text
 * string, keyed to the row's flat index, so `transcript-search.search` can
 * count and order matches over the entire transcript regardless of what is
 * mounted. Painting (a separate concern) then resolves DOM Ranges only for the
 * handful of mounted rows.
 *
 * **Fidelity via the shared parse cache.** Markdown rows (`assistant_text`)
 * are reduced to rendered text by reading through `ensureParsed` with the same
 * scope (`codeSessionStore.streamingDocument`) and identity
 * (`turn.${turnKey}.message.${messageKey}.text`) the renderer uses — so the
 * index free-rides on the parses `TugMarkdownBlock` already warmed rather than
 * re-running the WASM pipeline, and its text tracks what actually renders. The
 * block HTML is reduced to text with a scratch DOM element (entities decoded),
 * which is why the fidelity check ([Q01]) is an app-test, not a pure unit test.
 *
 * The index does **not** depend on the query — only the transcript snapshot and
 * expansion state. Callers rebuild it on those changes and re-run `search` over
 * the result on query/options changes.
 *
 * Scope for this step: `user`, `assistant_text`, `assistant_thinking`,
 * `system_note`. Shell exchanges and expanded tool / embedded-editor content
 * are added later (they need ANSI stripping / expansion gating / CM6 DOM).
 *
 * @module lib/transcript-search-index
 */

import { ensureParsed } from "@/lib/markdown/parse-cache";
import { findInlineMathRanges } from "@/lib/markdown/block-transformers/inline-math-walker";
import type { PropertyStore } from "@/components/tugways/property-store";
import type {
  DevRowDescriptor,
  DevTranscriptDataSource,
} from "@/lib/dev-transcript-data-source";

/** A row's message slice, from a committed turn or the in-flight turn. */
type RowMessages = NonNullable<DevRowDescriptor["turn"]>["messages"];

// Reused scratch element for HTML→text reduction (entities decoded, tags
// dropped). Created lazily so importing this module never touches the DOM —
// the DOM-free row kinds (user / thinking / system note) never reach it, so a
// pure unit test over those rows stays DOM-free.
let htmlScratch: HTMLDivElement | null = null;

/**
 * Strip unfenced `$…$` / `$$…$$` math, using the SAME detector
 * (`findInlineMathRanges`) the render pipeline uses to promote those spans into
 * `.tugx-katex`. pulldown-cmark leaves `$$…$$` as literal text in `block.html`
 * (it isn't a fenced block), so `.tugx-katex` removal alone misses it and the
 * LaTeX source (e.g. `\varepsilon`, which contains "are") leaks into the index.
 * The painter skips the rendered `.tugx-katex` in the DOM, so stripping here
 * keeps index ↔ DOM aligned.
 */
function stripInlineMath(text: string): string {
  const ranges = findInlineMathRanges(text);
  if (ranges.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    out += text.slice(cursor, range.start);
    cursor = range.end;
  }
  out += text.slice(cursor);
  return out;
}

function htmlToText(html: string): string {
  if (typeof document === "undefined") return html;
  if (htmlScratch === null) htmlScratch = document.createElement("div");
  htmlScratch.innerHTML = html;
  // Drop FENCED math: the parse-time `.tugx-katex` placeholder carries the
  // LaTeX source as text (e.g. `\varepsilon_0`). The painter skips the rendered
  // `.tugx-katex` in the DOM, so excluding it here keeps them aligned.
  for (const el of htmlScratch.querySelectorAll(".tugx-katex")) el.remove();
  // Drop UNFENCED `$…$` / `$$…$$` math, which cmark leaves as literal text.
  return stripInlineMath(htmlScratch.textContent ?? "");
}

/** Reduce one assistant markdown message to rendered text via the parse cache. */
function markdownMessageText(
  streamingStore: PropertyStore,
  turnKey: string,
  messageKey: string,
  fallbackText: string,
): string {
  const path = `turn.${turnKey}.message.${messageKey}.text`;
  const live = streamingStore.get(path);
  const text = typeof live === "string" ? live : fallbackText;
  if (text === "") return "";
  const blocks = ensureParsed(streamingStore, path, text);
  return blocks.map((b) => htmlToText(b.html)).join("\n");
}

/** Plain-text projection of a single message (searchable kinds only). */
function messageText(
  message: RowMessages[number],
  turnKey: string,
  streamingStore: PropertyStore,
): string {
  switch (message.kind) {
    case "user_message":
      return message.text;
    case "assistant_text":
      return markdownMessageText(
        streamingStore,
        turnKey,
        message.messageKey,
        message.text,
      );
    case "assistant_thinking":
      return message.text;
    case "system_note":
      return message.text;
    default:
      // tool_use / shell_exchange — added in a later step.
      return "";
  }
}

/** Plain-text projection of one transcript row, keyed to its flat index. */
function rowText(
  descriptor: DevRowDescriptor,
  streamingStore: PropertyStore,
): string {
  if (descriptor.kind === "ghost") return "";
  const messages: RowMessages | undefined =
    descriptor.turn?.messages ?? descriptor.activeTurn?.messages;
  if (
    messages === undefined ||
    descriptor.messageStart === undefined ||
    descriptor.messageEnd === undefined
  ) {
    // A `user` row exposes its message via `userMessage` rather than a slice.
    return descriptor.userMessage?.text ?? "";
  }
  const parts: string[] = [];
  for (let j = descriptor.messageStart; j < descriptor.messageEnd; j++) {
    const message = messages[j];
    if (message !== undefined) {
      parts.push(messageText(message, descriptor.turnKey, streamingStore));
    }
  }
  return parts.join("\n");
}

/**
 * Build the whole-transcript row→text index: `result[i]` is the searchable
 * plain text of data-source row `i` (empty for non-searchable rows). The array
 * length equals `dataSource.numberOfItems()`, so a match's `row` is a valid
 * `scrollToIndex` target.
 */
export function buildTranscriptSearchRows(
  dataSource: DevTranscriptDataSource,
  streamingStore: PropertyStore,
): string[] {
  const n = dataSource.numberOfItems();
  const rows: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = rowText(dataSource.rowAt(i), streamingStore);
  }
  return rows;
}
