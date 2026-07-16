/**
 * transcript-search-index — the query-independent store→text index behind the
 * Session card's Find route.
 *
 * The transcript is a virtualized list: almost every row is unmounted at any
 * moment (`OVERSCAN_COUNT = 3`), so a whole-transcript match count cannot come
 * from the DOM. This module projects **every** data-source row to an ordered
 * list of **search segments**, keyed to the row's flat index, so
 * `transcript-search.searchSegments` can count and order matches over the
 * entire transcript regardless of what is mounted. Painting (a separate
 * concern) then resolves DOM Ranges only for the handful of mounted rows.
 *
 * **Units mirror the DOM's `data-tugx-findable` containers.** Each projected
 * part corresponds 1:1, in DOM order, with one marked container in the row's
 * rendered cell (`transcript-find-highlighter.ts` walks exactly those). A
 * query is searched per unit on BOTH sides, so a match can never span two
 * containers — and the k-th index match in a row is the k-th DOM match, which
 * is the invariant navigation relies on. Adding a searchable kind is a
 * two-sided checklist: mark the container, project the same text here in the
 * same order, and extend the fidelity fixture.
 *
 * **Fidelity via the shared parse cache.** Markdown-rendered kinds (assistant
 * text, thinking, user bodies, scheduled wake notes) are reduced to rendered
 * text by reading through `ensureParsed` — for streamed kinds with the same
 * scope (`codeSessionStore.streamingDocument`) and identity
 * (`turn.${turnKey}.message.${messageKey}.text`) the renderer uses, so the
 * index free-rides on warm parses; for static kinds (user bodies, notes) the
 * cache entry is index-owned (first build parses, repeat builds hit). The
 * block HTML is reduced to text with a scratch DOM element (entities
 * decoded), which is why the fidelity check is an app-test, not a pure unit
 * test.
 *
 * The index does **not** depend on the query — only the transcript snapshot
 * and expansion state. Callers rebuild it on those changes and re-run the
 * search over the result on query/options changes.
 *
 * Scope: `user` bodies, `assistant_text`, `assistant_thinking`, rendered
 * `system_note`s (compact divider label, scheduled wake chip). A
 * `system_note` with `source: "other"` has no renderer, so it projects
 * nothing — the index never counts invisible text. Shell exchanges and
 * expanded tool content contribute expansion-gated `dom` segments;
 * embedded-editor content joins as `editor` segments in a later step.
 *
 * @module lib/transcript-search-index
 */

import { ensureParsed } from "@/lib/markdown/parse-cache";
import { findInlineMathRanges } from "@/lib/markdown/block-transformers/inline-math-walker";
import { stripAnsi } from "@/lib/ansi/strip-ansi";
import type { RowSegment } from "@/lib/transcript-search";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import { RETAINED_LINE_CAP } from "@/components/tugways/body-kinds/terminal-block";
import { parseGitCommit } from "@/components/tugways/body-kinds/commit-block";
import {
  extractTextOutput,
  resolveToolBlock,
} from "@/components/tugways/cards/session-assistant-renderer-dispatch";
import {
  BashToolBlock,
  composeTerminalData,
  narrowStructured as narrowBashStructured,
  tryParseBashDiff,
} from "@/components/tugways/cards/blocks/bash-tool-block";
import {
  DefaultToolBlock,
  pickOutputBody,
} from "@/components/tugways/cards/blocks/default-tool-block";
import { ReadToolBlock } from "@/components/tugways/cards/blocks/read-tool-block";
import { collapseDefaultForMessage } from "@/components/tugways/cards/blocks/tool-collapse-defaults";
import type { ToolBlockExpansionState } from "@/components/tugways/blocks/expansion-state";
import type { ToolUseMessage } from "@/lib/code-session-store/types";
import type { PropertyStore } from "@/components/tugways/property-store";
import type {
  SessionRowDescriptor,
  SessionTranscriptDataSource,
} from "@/lib/session-transcript-data-source";

/** A row's message slice, from a committed turn or the in-flight turn. */
type RowMessages = NonNullable<SessionRowDescriptor["turn"]>["messages"];

// Reused scratch element for HTML→text reduction (entities decoded, tags
// dropped). Created lazily so importing this module never touches the DOM —
// the DOM-free row kinds (compact notes, unrendered notes) never reach it, so
// a pure unit test over those rows stays DOM-free.
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

/**
 * Reduce markdown source to its rendered text via the shared parse cache.
 * Atom placeholders (`U+FFFC`) are removed from the result: the rendered DOM
 * replaces each with a chip host whose SVG label the painter excludes
 * (`.tug-atom-chip-host`), so the aligned projection is "no text there".
 */
function markdownToText(
  streamingStore: PropertyStore,
  identity: string,
  text: string,
): string {
  if (text === "") return "";
  const blocks = ensureParsed(streamingStore, identity, text);
  return blocks
    .map((b) => htmlToText(b.html))
    .join("\n")
    .split(TUG_ATOM_CHAR)
    .join("");
}

/**
 * Strip the `>` Code route prefix from a user body the way the user row's
 * renderer does (`stripUserBodyPrefix` in `session-card-transcript.tsx`) — the
 * projection must match the DISPLAYED text, not the wire text.
 */
function stripUserBodyPrefix(text: string): string {
  if (text.startsWith("> ")) return text.slice(2);
  if (text.startsWith(">")) return text.slice(1);
  return text;
}

/** Terminal output as the DOM renders it: stdout lines, then stderr lines
 *  (`renderTerminal`'s stream order), ANSI-stripped, capped at the
 *  retention limit so the count never exceeds what unfolding can reveal. */
function terminalText(stdout: string, stderr: string): string {
  const lines: string[] = [];
  if (stdout !== "") lines.push(...stripAnsi(stdout).split("\n"));
  if (stderr !== "") lines.push(...stripAnsi(stderr).split("\n"));
  return lines.slice(0, RETAINED_LINE_CAP).join("\n");
}

/**
 * Search segments of one EXPANDED tool call, mirroring what its wrapper
 * marks `data-tugx-findable` (plus `editor` segments for embedded editors):
 *
 *  - **Bash** (`BashToolBlock`): the header command, then — when the body is
 *    the terminal — its stdout-then-stderr text. The wrapper's smart-pick
 *    routing is mirrored via the SAME exported helpers it uses: a commit
 *    receipt replaces the command row entirely (nothing searchable), a
 *    streaming call and a diff-routed body keep only the command
 *    (`DiffBlock` content is out of scope).
 *  - **Default-routed tools** (`DefaultToolBlock`): the markdown text
 *    result (`pickOutputBody`'s `markdown` branch) on a `done` call. The
 *    JSON input tree is fold-dependent and stays unsearchable.
 *  - **Read** (`ReadToolBlock`): the file content as an `editor` segment.
 *  - Everything else (bespoke wrappers, hidden tools) contributes nothing.
 */
function toolUseSegments(
  message: ToolUseMessage,
  toolUseId: string,
  streamingStore: PropertyStore,
): RowSegment[] {
  const factory = resolveToolBlock(message.toolName);
  if (factory === ReadToolBlock) {
    // The Read body is an embedded CodeMirror editor over
    // `structured_result.file.content` — the SAME bytes `composeFileData`
    // feeds `FileBlock`. CM6 virtualizes its DOM, so this is an `editor`
    // segment: counted here, painted/navigated by the editor's own search.
    const structured = message.structuredResult as
      | { file?: { content?: unknown } }
      | null;
    const content =
      structured !== null &&
      typeof structured === "object" &&
      structured.file !== undefined &&
      typeof structured.file.content === "string"
        ? structured.file.content
        : undefined;
    if (content === undefined || content === "") return [];
    return [{ kind: "editor", key: toolUseId, text: content }];
  }
  if (factory === BashToolBlock) {
    const input = message.input as Record<string, unknown> | null;
    const command =
      input !== null && typeof input === "object" && typeof input.command === "string"
        ? input.command
        : undefined;
    const structured = narrowBashStructured(message.structuredResult);
    const textOutput = extractTextOutput(message.result);
    const isError = message.status === "error";
    const terminal = composeTerminalData(structured, textOutput, isError);
    // Commit receipt: the chrome swaps to the receipt identity — the raw
    // command row is not rendered, and `CommitBlock` is unmarked.
    if (
      message.status === "done" &&
      command !== undefined &&
      /\bgit\b[\s\S]*\bcommit\b/.test(command) &&
      parseGitCommit(command, terminal.stdout ?? "") !== null
    ) {
      return [];
    }
    const segments: RowSegment[] = [];
    if (command !== undefined && command !== "") {
      segments.push({ kind: "dom", text: command });
    }
    // Streaming has no body; a diff-routed body renders `DiffBlock`
    // (unmarked). Otherwise the body is the marked terminal — keyed so
    // navigation can open its internal fold.
    if (
      message.status !== "pending" &&
      tryParseBashDiff(terminal.stdout) === null
    ) {
      const text = terminalText(terminal.stdout ?? "", terminal.stderr ?? "");
      if (text !== "") segments.push({ kind: "dom", text, key: toolUseId });
    }
    return segments;
  }
  if (factory === DefaultToolBlock && message.status === "done") {
    const output = pickOutputBody(
      message.structuredResult,
      extractTextOutput(message.result),
    );
    if (output.kind === "markdown" && output.text !== "") {
      const identity = `tool.${toolUseId}.result`;
      const projected = markdownToText(streamingStore, identity, output.text);
      return projected === "" ? [] : [{ kind: "dom", text: projected }];
    }
  }
  return [];
}

/**
 * Search segments contributed by one message, in the same order the renderer
 * mounts that message's marked containers (searchable kinds only).
 */
function messageSegments(
  message: RowMessages[number],
  turnKey: string,
  streamingStore: PropertyStore,
  expansion: ToolBlockExpansionState,
): RowSegment[] {
  switch (message.kind) {
    case "user_message":
      // Rendered by the user row, not the assistant body — projected there.
      return [];
    case "assistant_text":
    case "assistant_thinking": {
      // Both render through `TugMarkdownBlock` subscribed to the SAME
      // streaming path the reducer writes, so this identity hits the
      // renderer-warmed parse cache. Read the live store value first — the
      // in-flight text can be ahead of the committed Message.
      const path = `turn.${turnKey}.message.${message.messageKey}.text`;
      const live = streamingStore.get(path);
      const text = typeof live === "string" ? live : message.text;
      const projected = markdownToText(streamingStore, path, text);
      return projected === "" ? [] : [{ kind: "dom", text: projected }];
    }
    case "system_note": {
      if (message.source === "compact") {
        // The compaction divider renders the text verbatim in a label span.
        return message.text === "" ? [] : [{ kind: "dom", text: message.text }];
      }
      if (message.source === "scheduled") {
        // The wake-trigger chip renders through `TugMarkdownBlock` in static
        // mode; the cache identity here is index-owned (the static renderer
        // parses via `renderIncremental`, not the cache).
        const identity = `turn.${turnKey}.message.${message.messageKey}.note`;
        const projected = markdownToText(streamingStore, identity, message.text);
        return projected === "" ? [] : [{ kind: "dom", text: projected }];
      }
      // `source: "other"` has no renderer — invisible text is not searchable.
      return [];
    }
    case "tool_use": {
      // Subagent children render inside their parent Agent block (out of
      // scope); top-level calls contribute only while EXPANDED — the
      // painter's collapse guard is the DOM-side mirror of this gate.
      if (message.parentToolUseId !== undefined) return [];
      const collapsed = expansion.resolve(
        message.toolUseId,
        collapseDefaultForMessage(message),
      );
      if (collapsed) return [];
      return toolUseSegments(message, message.toolUseId, streamingStore);
    }
    default:
      // shell_exchange never appears in an assistant slice.
      return [];
  }
}

/** Project a user body (markdown-rendered, prefix-stripped, chips removed). */
function userBodyParts(
  text: string,
  turnKey: string,
  messageKey: string,
  streamingStore: PropertyStore,
): string[] {
  const displayed = stripUserBodyPrefix(text);
  if (displayed === "") return [];
  // Index-owned cache identity — the user body renders via
  // `TugAtomMarkdownBody` → `TugMarkdownBlock` static mode, which does not
  // populate the shared cache.
  const identity = `turn.${turnKey}.message.${messageKey}.userbody`;
  const projected = markdownToText(streamingStore, identity, displayed);
  return projected === "" ? [] : [projected];
}

/**
 * Project one shell exchange as its two search units — the header command,
 * then the ANSI-stripped output capped at `RETAINED_LINE_CAP` lines (the
 * DOM's `TerminalBlock` retains at most that many, so the projection never
 * counts text no amount of unfolding can reveal). An exchange collapsed via
 * the expansion state contributes nothing — matching the painter's collapse
 * guard (the header command stays visible but unpainted; the plan accepts
 * that gap to keep the gate binary). Shell rows default expanded.
 */
function shellSegments(
  descriptor: SessionRowDescriptor,
  expansion: ToolBlockExpansionState,
): RowSegment[] {
  const message = descriptor.turn?.messages[0];
  if (message === undefined || message.kind !== "shell_exchange") return [];
  if (expansion.resolve(message.exchangeId, false)) return [];
  const segments: RowSegment[] = [];
  if (message.command !== "") {
    segments.push({ kind: "dom", text: message.command });
  }
  if (message.output !== "") {
    const visible = stripAnsi(message.output)
      .split("\n")
      .slice(0, RETAINED_LINE_CAP)
      .join("\n");
    if (visible !== "") {
      // Keyed: the terminal's internal fold can hide the tail of this unit;
      // navigation unfolds it through the card's FindTargetRegistry.
      segments.push({ kind: "dom", text: visible, key: message.exchangeId });
    }
  }
  return segments;
}

/** Wrap plain-text parts as `dom` segments. */
function domSegments(parts: string[]): RowSegment[] {
  return parts.map((text) => ({ kind: "dom" as const, text }));
}

/** Ordered search segments of one transcript row. */
function rowSegments(
  descriptor: SessionRowDescriptor,
  streamingStore: PropertyStore,
  expansion: ToolBlockExpansionState,
): RowSegment[] {
  if (descriptor.kind === "ghost") return [];
  if (descriptor.kind === "shell") {
    return shellSegments(descriptor, expansion);
  }
  if (descriptor.kind === "user") {
    const message = descriptor.userMessage;
    if (message === undefined) return [];
    return domSegments(
      userBodyParts(
        message.text,
        descriptor.turnKey,
        message.messageKey,
        streamingStore,
      ),
    );
  }
  const messages: RowMessages | undefined =
    descriptor.turn?.messages ?? descriptor.activeTurn?.messages;
  if (
    messages === undefined ||
    descriptor.messageStart === undefined ||
    descriptor.messageEnd === undefined
  ) {
    return [];
  }
  const segments: RowSegment[] = [];
  for (let j = descriptor.messageStart; j < descriptor.messageEnd; j++) {
    const message = messages[j];
    if (message !== undefined) {
      segments.push(
        ...messageSegments(message, descriptor.turnKey, streamingStore, expansion),
      );
    }
  }
  return segments;
}

/**
 * Build the whole-transcript row→segments index: `result[i]` is the ordered
 * list of search segments of data-source row `i` (empty for non-searchable
 * rows). The array length equals `dataSource.numberOfItems()`, so a match's
 * `row` is a valid `scrollToIndex` target.
 */
export function buildTranscriptSearchSegments(
  dataSource: SessionTranscriptDataSource,
  streamingStore: PropertyStore,
  expansion: ToolBlockExpansionState,
): RowSegment[][] {
  const n = dataSource.numberOfItems();
  const rows: RowSegment[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = rowSegments(dataSource.rowAt(i), streamingStore, expansion);
  }
  return rows;
}
