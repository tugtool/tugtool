/**
 * `TideThinkingBlock` — inline collapsible chrome for the assistant's
 * "thinking" stream within a Tide code row.
 *
 * Two modes (mutually exclusive):
 *
 *   1. **Streaming** — `<TideThinkingBlock streamingStore={…}
 *      streamingPath="inflight.thinking" />`. Subscribes to a
 *      `PropertyStore` path and renders deltas live. Default-expanded
 *      so the user can watch reasoning as it arrives. The block self-
 *      hides when the path holds no content yet (no thinking →
 *      no chrome).
 *
 *   2. **Static** — `<TideThinkingBlock initialText={turn.thinking} />`.
 *      Renders a finished turn's thinking. Default-**collapsed** per
 *      [D14] — once the answer is in, the reasoning trail is
 *      supplementary; the user opts in to expand. Renders nothing
 *      when `initialText` is empty (parent is welcome to skip the
 *      mount altogether — both work).
 *
 * Once the user toggles the block, that state holds until the cell
 * unmounts (per row lifetime [D14]). Re-mount (scroll-out → scroll-in
 * across the virtualized list view, or row swap from streaming →
 * committed on `turn_complete`) starts from the mode default again.
 *
 * Composition:
 * - The body delegates to `TugMarkdownBlock` so thinking prose
 *   inherits the typography pass from #step-2 / #step-3 (footnotes,
 *   smart-punct, inline emphasis, etc.). The wrapping chrome is the
 *   only piece this component owns.
 *
 * Laws:
 * - [L03] `useLayoutEffect` for the initial-render and streaming
 *   subscription so DOM is in place before paint.
 * - [L06] appearance changes go through CSS / DOM. The collapse
 *   toggle flips `data-collapsed` on the root; CSS animates the
 *   body height. No React rerender per delta.
 * - [L19] `.tsx` + `.css` pair, exported props interface,
 *   `data-slot="tide-thinking-block"`.
 * - [L20] component-token sovereignty — owns the `--tugx-thinking-*`
 *   slot family ([Table T07]), declared in `brio.css` and
 *   `harmony.css`.
 * - [L22] streaming binding in streaming mode subscribes the body's
 *   `TugMarkdownBlock` directly to the `PropertyStore`; deltas write
 *   the DOM imperatively without a React render cycle. The chrome
 *   side (visibility + preview) reads the same store via
 *   `observe()` and updates two attributes / one text node — also
 *   imperatively, no React state per delta.
 *
 * Decisions:
 * - [D14] default-collapsed-on-complete is the static-mode default.
 *
 * @module components/tugways/chrome/tide-thinking-block
 */

import "./tide-thinking-block.css";

import React from "react";
import { ChevronRight } from "lucide-react";

import type { PropertyStore } from "@/components/tugways/property-store";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";

/**
 * Maximum length of the collapsed-state preview line before truncation.
 * Picked to fit the typical Tide card width without wrapping at
 * 14-16 px label sizes. Exported for the test that asserts truncation.
 */
export const PREVIEW_MAX_LENGTH = 80;

/**
 * Compute a one-line preview from a multiline thinking string. Takes
 * the first non-empty line, collapses interior whitespace, and
 * truncates with a trailing ellipsis above `PREVIEW_MAX_LENGTH`.
 *
 * Exported for unit tests; production callers route through the
 * component itself.
 */
export function computePreview(text: string): string {
  if (text === "") return "";
  // First non-empty line — Claude sometimes opens thinking with a
  // blank line, and a leading "" preview would collapse the chrome's
  // spatial cue.
  const lines = text.split("\n");
  let firstLine = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      firstLine = trimmed;
      break;
    }
  }
  if (firstLine === "") return "";
  // Collapse interior whitespace runs (tabs, multiple spaces) so the
  // preview reads as a single sentence-style fragment.
  const collapsed = firstLine.replace(/\s+/g, " ");
  if (collapsed.length <= PREVIEW_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}

/**
 * Props for `TideThinkingBlock`. `initialText` and `streamingStore`
 * are mutually exclusive at mount; if both are supplied, streaming
 * mode wins (mirrors `TugMarkdownBlock`).
 */
export interface TideThinkingBlockProps {
  /**
   * Static thinking text from a completed turn (`TurnEntry.thinking`).
   * The block mounts default-**collapsed** per [D14].
   */
  initialText?: string;

  /**
   * `PropertyStore` for in-flight thinking. The block subscribes on
   * mount, renders deltas live, and self-hides while the path's
   * value is empty.
   */
  streamingStore?: PropertyStore;

  /**
   * `PropertyStore` path the block subscribes to in streaming mode.
   * Required when `streamingStore` is set — consumers thread the
   * appropriate path (e.g. the transcript constructs
   * `turn.${turnKey}.thinking` per the per-turn-paths architecture
   * documented in `code-session-store.ts`'s write-inflight processor).
   */
  streamingPath?: string;

  /**
   * Forwarded class name. Cascade-scoped customization happens here —
   * consumers tune `--tugx-thinking-*` tokens via a wrapping selector
   * per [L20].
   */
  className?: string;
}

export const TideThinkingBlock: React.FC<TideThinkingBlockProps> = ({
  initialText,
  streamingStore,
  streamingPath,
  className,
}) => {
  const isStreaming = streamingStore !== undefined;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const previewRef = React.useRef<HTMLSpanElement | null>(null);

  // Collapse default per [D14]: streaming → expanded; static → collapsed.
  // Tracks the user's most recent toggle for the cell's lifetime; a
  // remount restores the default.
  const [collapsed, setCollapsed] = React.useState(!isStreaming);

  const handleToggle = React.useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  // ---------- Streaming mode: subscribe for content + preview state.
  //
  // Two reads from the same path: TugMarkdownBlock subscribes for the
  // body content, this effect subscribes for the chrome (`data-empty`
  // attribute + collapsed-state preview text). Both unsubscribe on
  // unmount — keeping the chrome's read separate avoids passing a
  // ref/callback through TugMarkdownBlock's props.
  React.useLayoutEffect(() => {
    if (!isStreaming) return;
    const root = rootRef.current;
    const preview = previewRef.current;
    if (root === null || preview === null) return;
    const store = streamingStore;
    if (store === undefined) return;
    if (streamingPath === undefined) return;

    function applyChromeFor(text: string): void {
      const r = rootRef.current;
      const p = previewRef.current;
      if (r === null || p === null) return;
      r.dataset.empty = text.length === 0 ? "true" : "false";
      p.textContent = computePreview(text);
    }

    applyChromeFor((store.get(streamingPath) as string | undefined) ?? "");

    let pending: number | null = null;
    const flush = () => {
      pending = null;
      const text = (store.get(streamingPath) as string | undefined) ?? "";
      applyChromeFor(text);
    };
    const unsubscribe = store.observe(streamingPath, () => {
      if (pending !== null) return;
      pending = requestAnimationFrame(flush);
    });

    return () => {
      if (pending !== null) {
        cancelAnimationFrame(pending);
        pending = null;
      }
      unsubscribe();
    };
  }, [isStreaming, streamingStore, streamingPath]);

  // ---------- Static mode: one-shot chrome state at mount.
  React.useLayoutEffect(() => {
    if (isStreaming) return;
    const root = rootRef.current;
    const preview = previewRef.current;
    if (root === null || preview === null) return;
    const text = initialText ?? "";
    root.dataset.empty = text.length === 0 ? "true" : "false";
    preview.textContent = computePreview(text);
    // Mount-once contract — initialText changes after mount are
    // ignored; consumers remount via a fresh React key when the
    // committed thinking text would change. This matches
    // `TugMarkdownBlock`'s static-mode contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      data-slot="tide-thinking-block"
      data-mode={isStreaming ? "streaming" : "static"}
      data-collapsed={collapsed ? "true" : "false"}
      data-empty="true"
      className={
        className === undefined
          ? "tide-thinking-block"
          : `tide-thinking-block ${className}`
      }
    >
      <button
        type="button"
        className="tide-thinking-block-header"
        aria-expanded={collapsed ? "false" : "true"}
        aria-controls="tide-thinking-block-body"
        onClick={handleToggle}
      >
        <ChevronRight
          aria-hidden="true"
          size={14}
          className="tide-thinking-block-chevron"
        />
        <span className="tide-thinking-block-label">Thinking</span>
        <span ref={previewRef} className="tide-thinking-block-preview" />
      </button>
      <div
        id="tide-thinking-block-body"
        className="tide-thinking-block-body"
        // The viewport row is the grid track that animates between
        // 0fr (collapsed) and 1fr (expanded). The inner content
        // overflow:hidden prevents the body from spilling out during
        // the height interpolation.
      >
        <div className="tide-thinking-block-viewport">
          <div className="tide-thinking-block-content">
            {isStreaming ? (
              <TugMarkdownBlock
                streamingStore={streamingStore}
                streamingPath={streamingPath}
              />
            ) : (
              <TugMarkdownBlock initialText={initialText ?? ""} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
