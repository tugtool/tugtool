/**
 * `mathTransformer` — promotes ` ```math `, ` ```latex `, and ` ```tex `
 * fenced-code blocks to a `tug-math-display` opaque body kind for
 * downstream KaTeX rendering (display mode).
 *
 * Stubbed in [#step-3] (no-op pass-through). Populated in [#step-13] —
 * `KaTeXBlock` body kind + lazy KaTeX loader. Inline math (`$...$`,
 * `$$...$$`) is handled separately by a post-DOMPurify text-node walk
 * inside `MarkdownBlock` rendering, not here ([D07]).
 */

import type { BlockTransformer } from "./index";

export const mathTransformer: BlockTransformer = {
  name: "math",
  transform(block) {
    return [block];
  },
};
