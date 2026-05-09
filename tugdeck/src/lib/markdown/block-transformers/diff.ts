/**
 * `diffTransformer` — promotes ` ```diff ` fenced-code blocks to a
 * `tug-diff` opaque body kind, which dispatches to the read-only mode
 * of `DiffBlock`.
 *
 * Stubbed in [#step-3] (no-op pass-through). Populated alongside the
 * `DiffBlock` body kind in [#step-10] / [#step-11] — once the
 * `tugdiff-wasm` crate ships and `DiffBlock` is wired through the
 * dispatch.
 */

import type { BlockTransformer } from "./index";

export const diffTransformer: BlockTransformer = {
  name: "diff",
  transform(block) {
    return [block];
  },
};
