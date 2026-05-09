/**
 * `largeJsonTransformer` — promotes ` ```json ` fenced-code blocks
 * over a size threshold (~2 KB per [D07]) to a `tug-json-tree` opaque
 * body kind, where `JsonTreeBlock` renders an interactive tree view
 * instead of a syntax-highlighted text dump.
 *
 * Stubbed in [#step-3] (no-op pass-through). Populated alongside the
 * `JsonTreeBlock` body kind in [#step-15].
 */

import type { BlockTransformer } from "./index";

export const largeJsonTransformer: BlockTransformer = {
  name: "large-json",
  transform(block) {
    return [block];
  },
};
