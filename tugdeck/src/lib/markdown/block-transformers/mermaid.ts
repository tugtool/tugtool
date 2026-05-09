/**
 * `mermaidTransformer` — promotes ` ```mermaid ` fenced-code blocks to
 * a `tug-mermaid` opaque body kind for downstream lazy-loaded mermaid
 * rendering.
 *
 * Stubbed in [#step-3] (no-op pass-through) so the pipeline compiles
 * and the dispatch contract is in place. Populated in [#step-12] —
 * `MermaidBlock` body kind + lazy mermaid loader. Until then, mermaid
 * fences render as plain code (the empirical session audit found no
 * actual mermaid usage in 1,031 sessions, so the no-op cost is zero).
 */

import type { BlockTransformer } from "./index";

export const mermaidTransformer: BlockTransformer = {
  name: "mermaid",
  transform(block) {
    return [block];
  },
};
