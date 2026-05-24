/**
 * `render-incremental.ts` — incremental streaming-markdown reconciler.
 *
 * Replaces the rebuild-everything pattern in `tug-markdown-block.tsx`'s
 * streaming path with a per-block diff that mutates only what changed.
 * The driving requirement is preservation of *DOM element identity* for
 * blocks that did not change between renders: browser scroll anchoring
 * (`overflow-anchor: auto`) anchors on a specific element near the top
 * of the viewport, and any rebuild that destroys that element causes
 * the browser to pick a fresh anchor — visible as the transcript
 * snapping back to the top on every streaming delta. By keeping the
 * `.tugx-md-block` wrappers for the stable prefix unchanged across
 * renders, the anchor candidate persists and the scroll position holds.
 *
 * **Two layers, separately testable.**
 *
 *  1. `planReconcile` — pure logic. Given the previous render's
 *     per-block content hashes and the new render's hashes, returns a
 *     `ReconcilePlan` describing the four index ranges (stable,
 *     update-in-place, append, remove). No DOM. No state. Exhaustively
 *     unit-tested.
 *
 *  2. `renderIncremental` — DOM-mutating wrapper. Parses the new text,
 *     calls `planReconcile`, then applies the plan against the
 *     container's children. Returns the new `RenderState` for the
 *     consumer to pass back on the next call. HMR-vetted (no
 *     fake-DOM render tests per project policy).
 *
 * **Hash source.** Per-block FNV-1a 64-bit hashes computed in Rust
 * during the `lex_blocks` pass and surfaced on
 * `SanitizedMarkdownBlock.contentHash` (see [#step-18-8] commit 1/3).
 * Hashing the source byte range (not the rendered HTML) is correct
 * because `pulldown-cmark` is deterministic — same source range, same
 * parser options, same HTML output.
 *
 * **Cross-block features (footnotes, reference links).** A footnote
 * definition added later in the document changes the rendered HTML of
 * an earlier reference, but the reference's source byte range is
 * unchanged. Source-range hashing therefore classifies the earlier
 * block as stable and the reconciler skips it, leaving stale HTML in
 * place until the user interacts. Acceptable trade-off for the
 * streaming-markdown case (footnotes are rare in tool-generated
 * output); a future enhancement could hash the rendered HTML for
 * stronger correctness at a small Rust-side cost.
 *
 * Laws:
 *  - [L02] no React state; the reconciler is invoked from the same
 *    `useLayoutEffect` that owns the streaming subscription.
 *  - [L06] DOM mutations only; no React rerender per delta.
 *  - [L19] file pair (this `.ts` + a sibling test file), module
 *    docstring, exported types.
 *  - [L22] streaming subscription writes DOM imperatively via this
 *    helper; React's render cycle is bypassed for per-delta updates.
 *  - [L23] preserves user-visible scroll position by preserving the
 *    DOM element identity that browser scroll anchoring depends on.
 *
 * @module lib/markdown/render-incremental
 */

import { DEFAULT_BLOCK_TRANSFORMERS } from "./block-transformers";
import { enhanceFencedCode } from "./enhance-fenced-code";
import { enhanceImg } from "./enhance-img";
import { enhanceMath } from "./enhance-math";
import { enhanceMermaid } from "./enhance-mermaid";
import {
  parseMarkdownToSanitizedBlocks,
  type ParseMarkdownOptions,
  type SanitizedMarkdownBlock,
} from "./parse-markdown-to-sanitized-blocks";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * State the reconciler caches between renders. The consumer should
 * keep one `RenderState` per container — typically via a
 * `WeakMap<HTMLElement, RenderState>` — and pass the previous result
 * back to {@link renderIncremental} on the next call.
 */
export interface RenderState {
  /** Per-block content hashes from the most recent render, in document order. */
  readonly hashes: ReadonlyArray<bigint>;
  /**
   * Per-block kinds from the most recent render. Carried for
   * debuggability and as a forward-looking heuristic surface; not
   * used by the reconciler today.
   */
  readonly kinds: ReadonlyArray<string>;
}

/**
 * Index-range plan for one reconciliation pass. Indexes refer to the
 * **new** block list (so `stableCount + updateCount` is the count of
 * positions covered by both lists, and `appendCount` extends beyond
 * the previous length).
 *
 * Invariants the reconciler preserves:
 *   - `stableCount + updateCount === min(prev.length, new.length)`
 *   - `appendCount === max(0, new.length - prev.length)`
 *   - `removeCount === max(0, prev.length - new.length)`
 *   - At least one of `appendCount` and `removeCount` is zero.
 */
export interface ReconcilePlan {
  /** Leading blocks whose hash matched at every index — DOM untouched. */
  stableCount: number;
  /** Following blocks at matching indices whose hashes diverged — innerHTML rewrite. */
  updateCount: number;
  /** Blocks beyond the previous length — append fresh wrappers. */
  appendCount: number;
  /** Trailing blocks past the new length — remove existing wrappers. */
  removeCount: number;
}

/** Outcome of one {@link renderIncremental} call. */
export interface RenderResult {
  /** New state — pass this back on the next call to {@link renderIncremental}. */
  state: RenderState;
  /** Plan that was applied. Useful for instrumentation / tests. */
  plan: ReconcilePlan;
}

// ---------------------------------------------------------------------------
// Pure-logic core — exported for the test suite.
// ---------------------------------------------------------------------------

/**
 * Compute the {@link ReconcilePlan} that turns `prevHashes` into
 * `newHashes` with minimal DOM mutation. Pure; exhaustively tested.
 *
 * Algorithm:
 *   1. Walk both arrays from index 0 in lockstep, counting positions
 *      where the hashes match. That run is the *stable prefix* — its
 *      DOM wrappers stay byte-identical across renders, the browser's
 *      scroll-anchor element persists, and the user's scroll position
 *      is preserved.
 *   2. From the divergence point through `min(prev, new)`, the
 *      reconciler will rewrite each existing wrapper's `innerHTML`
 *      in place — same DOM node, new content. The wrapper element
 *      itself is preserved; only its children and `dataset.blockType`
 *      change.
 *   3. Beyond `prev.length`, the reconciler appends new wrappers.
 *   4. Beyond `new.length`, the reconciler removes trailing wrappers.
 */
export function planReconcile(
  prevHashes: ReadonlyArray<bigint>,
  newHashes: ReadonlyArray<bigint>,
): ReconcilePlan {
  let stableCount = 0;
  const minLen = Math.min(prevHashes.length, newHashes.length);
  while (
    stableCount < minLen &&
    prevHashes[stableCount] === newHashes[stableCount]
  ) {
    stableCount += 1;
  }
  return {
    stableCount,
    updateCount: minLen - stableCount,
    appendCount: Math.max(0, newHashes.length - prevHashes.length),
    removeCount: Math.max(0, prevHashes.length - newHashes.length),
  };
}

// ---------------------------------------------------------------------------
// DOM-mutating wrapper
// ---------------------------------------------------------------------------

/**
 * The CSS class every block wrapper carries. Shared with the static
 * `renderBlocks` path in `tug-markdown-block.tsx` so a container can
 * be migrated from one renderer to the other without restyling.
 */
const BLOCK_CLASS = "tugx-md-block";

function buildBlockElement(block: SanitizedMarkdownBlock): HTMLDivElement {
  const el = document.createElement("div");
  el.className = BLOCK_CLASS;
  el.dataset.blockType = block.type;
  el.innerHTML = block.html;
  enhanceFencedCode(el);
  enhanceImg(el);
  void enhanceMath(el);
  void enhanceMermaid(el);
  return el;
}

function updateBlockElement(
  el: HTMLElement,
  block: SanitizedMarkdownBlock,
): void {
  el.dataset.blockType = block.type;
  el.innerHTML = block.html;
  enhanceFencedCode(el);
  enhanceImg(el);
  void enhanceMath(el);
  void enhanceMermaid(el);
}

/**
 * Reconcile `container`'s children against `text`'s parsed blocks,
 * mutating only what changed. Returns the new {@link RenderState} for
 * the consumer to pass back on the next call.
 *
 * Empty input clears the container and returns an empty state — the
 * consumer can treat the next call as a fresh start.
 */
export function renderIncremental(
  container: HTMLElement,
  text: string,
  prev: RenderState | null,
  options?: ParseMarkdownOptions,
): RenderResult {
  if (text === "") {
    const removeCount = prev?.hashes.length ?? 0;
    container.replaceChildren();
    return {
      state: { hashes: [], kinds: [] },
      plan: { stableCount: 0, updateCount: 0, appendCount: 0, removeCount },
    };
  }

  // Default the block-transformer pass to the populated transformers
  // (math, etc.) when the caller doesn't override. A consumer that
  // wants a different list (or an empty one for raw markdown) can
  // pass `options.transformers` explicitly.
  const mergedOptions: ParseMarkdownOptions = {
    isComplete: options?.isComplete,
    transformers: options?.transformers ?? DEFAULT_BLOCK_TRANSFORMERS,
  };
  const blocks = parseMarkdownToSanitizedBlocks(text, mergedOptions);
  const newHashes = blocks.map((b) => b.contentHash);
  const newKinds = blocks.map((b) => b.type);
  const prevHashes = prev?.hashes ?? [];
  const plan = planReconcile(prevHashes, newHashes);

  // Snapshot existing children once. The reconciler's contract is
  // that it owns every child of `container` (no foreign nodes); the
  // consumer (the streaming `useLayoutEffect`) is the only writer.
  const existing = Array.from(container.children) as HTMLElement[];

  // Phase 1 — in-place updates over the divergent matching range.
  // Preserves wrapper element identity (browser scroll anchor stays
  // valid), only the wrapper's inner subtree is replaced.
  for (
    let i = plan.stableCount;
    i < plan.stableCount + plan.updateCount;
    i += 1
  ) {
    const child = existing[i];
    if (child === undefined) {
      // Defensive: state and DOM disagreed (unexpected). Treat the
      // missing slot as an append so the new content still lands.
      container.appendChild(buildBlockElement(blocks[i]));
      continue;
    }
    updateBlockElement(child, blocks[i]);
  }

  // Phase 2 — append new wrappers beyond the previous length.
  for (
    let i = prevHashes.length;
    i < prevHashes.length + plan.appendCount;
    i += 1
  ) {
    container.appendChild(buildBlockElement(blocks[i]));
  }

  // Phase 3 — remove trailing wrappers past the new length. Walked
  // tail-to-head so each removal doesn't shift the indices of the
  // wrappers we still need to remove.
  if (plan.removeCount > 0) {
    for (let i = existing.length - 1; i >= newHashes.length; i -= 1) {
      existing[i].remove();
    }
  }

  return {
    state: { hashes: newHashes, kinds: newKinds },
    plan,
  };
}
