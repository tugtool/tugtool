/**
 * `range-to-blocks.ts` — the DOM half of transcript COPY's markdown
 * reconstruction ([#partial-copy-design]).
 *
 * An assistant row's body is a flat sequence of top-level transcript
 * blocks — markdown prose (`TugMarkdownBlock`), tool calls, thinking —
 * rendered in document order by `CodeRowBody`. This module resolves a
 * live `Selection` to the markdown for whatever sub-range it covers:
 *
 *  - The caller supplies `docBlocks`, the ordered description of the
 *    body's top-level children (one entry per rendered block, in the
 *    same order `CodeRowBody` produced them). Each entry knows how to
 *    yield its own markdown — a markdown block carries its message's
 *    source string; a tool block carries a serializer.
 *  - We walk the body's DOM children in lockstep with `docBlocks`, test
 *    each against the selection range, and for the touched ones gather
 *    per-block markdown: a markdown block slices its source to the
 *    touched `.tugx-md-block` wrappers (block-level [Q02], via the
 *    `data-md-start`/`data-md-end` attribution from Step 6); a tool
 *    block serializes whole; thinking/other are omitted, matching
 *    `turnEntryToMarkdown`.
 *  - {@link stitchSelectionMarkdown} assembles the result so a whole-row
 *    selection reproduces the full-row COPY output exactly.
 *
 * The pure arithmetic (slice-range, stitch) lives in
 * `selection-to-markdown.ts` and is `bun:test`-ed there; this file
 * touches the live DOM (`Range`, `document`) and is exercised by the
 * `just app-test` selection cases ([Q02] pure/DOM split).
 *
 * Laws: [L07] the caller samples the live selection inside the copy
 * gesture and passes it here; this module reads the DOM but holds no
 * state.
 *
 * @module lib/markdown/range-to-blocks
 */

import {
  sliceBlockRange,
  type SourceSpan,
  stitchSelectionMarkdown,
} from "./selection-to-markdown";

/** A top-level markdown block — its message's full source markdown. */
export interface MarkdownDocBlock {
  readonly kind: "markdown";
  /** The source string the rendered `.tugx-md-block` offsets index into. */
  readonly source: string;
}

/** A top-level tool block — serialized lazily, only when the selection touches it. */
export interface ToolDocBlock {
  readonly kind: "tool";
  /** Markdown for the whole tool call (reuses `turnEntryToMarkdown`'s per-tool path). */
  readonly serialize: () => string;
}

/** A block rendered in the body but omitted from copy (thinking, compaction divider). */
export interface OmittedDocBlock {
  readonly kind: "thinking" | "other";
}

/**
 * One entry per top-level child the assistant body rendered, in
 * document order. The array must align 1:1 with the leading children of
 * the body element (trailing live-only slots — permission / question —
 * sit after every doc block and are ignored).
 */
export type DocBlock = MarkdownDocBlock | ToolDocBlock | OmittedDocBlock;

/**
 * True when `node` shares interior with `range` — a strict overlap that
 * excludes a pure boundary touch, so a selection ending exactly at a
 * block edge doesn't drag in the adjacent block. Falls back to
 * `Range.intersectsNode` if boundary comparison is unavailable.
 */
function rangeOverlapsNode(range: Range, node: Node): boolean {
  const doc = node.ownerDocument;
  if (doc === null) return false;
  try {
    const nodeRange = doc.createRange();
    nodeRange.selectNode(node);
    // overlap ⟺ range.start < node.end AND range.end > node.start
    const startBeforeNodeEnd =
      range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0;
    const endAfterNodeStart =
      range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0;
    return startBeforeNodeEnd && endAfterNodeStart;
  } catch {
    return typeof range.intersectsNode === "function"
      ? range.intersectsNode(node)
      : false;
  }
}

/**
 * Collect the source spans of the `.tugx-md-block` wrappers a selection
 * touches inside one markdown container. Each touched wrapper
 * contributes its whole `[data-md-start, data-md-end)` range
 * (block-level [Q02]).
 */
function touchedSpans(range: Range, container: HTMLElement): SourceSpan[] {
  const spans: SourceSpan[] = [];
  const wrappers = container.querySelectorAll<HTMLElement>(
    ":scope > .tugx-md-block",
  );
  for (const wrapper of wrappers) {
    if (!rangeOverlapsNode(range, wrapper)) continue;
    const start = Number(wrapper.dataset.mdStart);
    const end = Number(wrapper.dataset.mdEnd);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      spans.push({ start, end });
    }
  }
  return spans;
}

/**
 * Reconstruct markdown for the portion of `selection` that falls within
 * `bodyEl`. `docBlocks` describes the body's top-level children in
 * order. Returns the stitched markdown, or `null` when nothing copyable
 * was touched (so the caller can decide its own fallback).
 */
export function selectionToTranscriptMarkdown(
  selection: Selection,
  bodyEl: HTMLElement,
  docBlocks: ReadonlyArray<DocBlock>,
): string | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const children = Array.from(bodyEl.children) as HTMLElement[];
  // Leading children align 1:1 with docBlocks; trailing live-only slots
  // come after. If the DOM has fewer children than doc blocks the
  // alignment is unsafe — bail so the caller falls back.
  if (children.length < docBlocks.length) return null;

  const toolSections: string[] = [];
  const proseChunks: string[] = [];

  for (let i = 0; i < docBlocks.length; i += 1) {
    const child = children[i];
    if (child === undefined) break;
    if (!rangeOverlapsNode(range, child)) continue;
    const block = docBlocks[i];
    if (block.kind === "markdown") {
      const spans = touchedSpans(range, child);
      // Container overlapped but no wrapper did (e.g. selection grazed
      // container padding) — fall back to the whole message source.
      const slice =
        spans.length > 0
          ? sliceBlockRange(block.source, spans)
          : block.source;
      if (slice.length > 0) proseChunks.push(slice);
    } else if (block.kind === "tool") {
      const md = block.serialize();
      if (md.length > 0) toolSections.push(md);
    }
    // thinking / other → omitted, matching turnEntryToMarkdown.
  }

  const out = stitchSelectionMarkdown(toolSections, proseChunks);
  return out.length > 0 ? out : null;
}
