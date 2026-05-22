/**
 * Block-transformer pass — types and registry barrel for the
 * post-sanitize transformation hook in `parseMarkdownToSanitizedBlocks`.
 *
 * The pipeline runs in this order:
 *
 *   1. `lex_blocks` — pulldown-cmark WASM block lexer
 *   2. `parse_to_html` — pulldown-cmark WASM HTML emitter
 *   3. `DOMPurify.sanitize` — strip anything the allowlist doesn't permit
 *   4. **block-transformer pass** — flat-map each block through every
 *      registered transformer, in order, with a `BlockTransformContext`
 *
 * Transformers are pure: they take a single `SanitizedMarkdownBlock`
 * plus a `BlockTransformContext` and return a (possibly modified)
 * list. A transformer may:
 *   - return `[block]` — leave the block unchanged
 *   - return `[]` — drop the block from the output
 *   - return `[modified]` — replace it (typical: change `type` from
 *     `code` to `tug-mermaid`, `tug-math-display`, `tug-diff`,
 *     `tug-json-tree`, etc.)
 *   - return `[a, b, c]` — split it into multiple sibling blocks
 *
 * The transformer pass keeps `parseMarkdownToSanitizedBlocks` agnostic
 * to downstream rendering choices. Rendering (`MarkdownBlock`,
 * `TugMarkdownView`, etc.) keys off `block.type` to dispatch to the
 * right component; transformers promote a generic `code` block into a
 * specialized `tug-*` type when the fence's language hint matches.
 *
 * Streaming-aware: `BlockTransformContext.isComplete` is `true` only
 * for blocks whose source text has reached `complete` status, so a
 * transformer can stay as a plain code block while content is still
 * flowing in (mermaid, for example, only promotes on `complete` per
 * [D07]).
 *
 * The barrel re-exports the four initial transformers (`mermaid`,
 * `math`, `diff`, `large-json`) per [List L02]. They ship as no-op
 * stubs in [#step-3] — the spec contract is in place so the pipeline
 * compiles and the tests prove transformer composition works — and
 * are populated in their consuming steps ([#step-12], [#step-13],
 * [#step-10] / [#step-11], [#step-15]).
 */

import type { SanitizedMarkdownBlock } from "../parse-markdown-to-sanitized-blocks";

/**
 * Context passed to every transformer for one transform invocation.
 */
export interface BlockTransformContext {
  /**
   * Whether the source text has reached `complete` status. Streaming
   * transformers (e.g. `mermaid`) defer their promotion until this is
   * `true` so a partially-streamed diagram doesn't render as broken
   * SVG; a renderer that doesn't care reads it as `true` always.
   */
  isComplete: boolean;
  /** Block index in the parent block list (post-flatten order). */
  index: number;
}

/**
 * One block-transformer in the post-sanitize pass. Pure — no side
 * effects, no DOM access. Takes a single block, returns a list.
 */
export interface BlockTransformer {
  /** Stable name for diagnostics and audit logs. */
  name: string;
  /**
   * Transform a single block. Return `[block]` to leave it unchanged,
   * `[]` to drop it, `[modified]` to replace it, or `[a, b, c]` to
   * split it into multiple siblings.
   */
  transform(
    block: SanitizedMarkdownBlock,
    context: BlockTransformContext,
  ): SanitizedMarkdownBlock[];
}

/**
 * Apply a sequence of transformers to a block list. Each transformer
 * runs over the *current* block list (the output of the previous
 * transformer), so transformer order is significant for transformers
 * whose outputs may be re-matched by a later transformer. For the
 * initial set ([List L02]) the transformers' input predicates don't
 * overlap, so order is independent.
 */
export function applyBlockTransformers(
  blocks: SanitizedMarkdownBlock[],
  transformers: ReadonlyArray<BlockTransformer>,
  options?: { isComplete?: boolean },
): SanitizedMarkdownBlock[] {
  if (transformers.length === 0) return blocks;
  const isComplete = options?.isComplete ?? true;
  let current = blocks;
  for (const transformer of transformers) {
    const next: SanitizedMarkdownBlock[] = [];
    for (let i = 0; i < current.length; i += 1) {
      const out = transformer.transform(current[i], { isComplete, index: i });
      for (let j = 0; j < out.length; j += 1) next.push(out[j]);
    }
    current = next;
  }
  return current;
}

export { mermaidTransformer } from "./mermaid";
export { mathTransformer } from "./math";
export { diffTransformer } from "./diff";
export { largeJsonTransformer } from "./large-json";

import { mathTransformer } from "./math";

/**
 * The default transformer list applied by the shared markdown
 * primitives (`TugMarkdownBlock` + `TugMarkdownView`). Each entry is
 * a populated transformer; pass-through stubs are left out so they
 * don't burn cycles flat-mapping over every block list.
 *
 * Order is significant in principle — `applyBlockTransformers` flat-
 * maps in array order — but the populated transformers' input
 * predicates (lang === "math" / "latex" / "tex" for math; future
 * fences for the others) don't overlap. Adding a new transformer
 * here lights it up across the whole markdown pipeline.
 */
export const DEFAULT_BLOCK_TRANSFORMERS: ReadonlyArray<BlockTransformer> = [
  mathTransformer,
];
