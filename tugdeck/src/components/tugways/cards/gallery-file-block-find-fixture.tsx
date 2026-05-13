/**
 * `gallery-file-block-find-fixture` — content-owning test fixture for
 * AT0071 / AT0072 / AT0073.
 *
 * Drives the framework-axis contract introduced in Phase E.10
 * (`bag.focus` for content-owning cards). Renders a single `FileBlock`
 * with a stable `componentStatePreservationKey` so the find row's
 * `data-tug-focus-key` survives:
 *
 *   - **App-switch (AT0071).** Saving on window-blur captures
 *     `bag.focus = { kind: "dom", focusKey: "file-block-find/<key>" }`.
 *     Becoming-active re-applies via the resolver branch above
 *     `dispatch-activated`.
 *   - **Card-switch (AT0072).** Activating Card B saves Card A's
 *     `bag.focus`; reactivating Card A restores focus onto the find
 *     input through `resolveActivationTarget`.
 *   - **Reload (AT0073).** Developer > Reload flushes
 *     `bag.components[<key>/file-block-find]` carrying `open=true` +
 *     query; cold-boot `useSavedComponentState` reads it back during
 *     `useState` init so the row mounts in its saved state on first
 *     paint, and `applyFocusSnapshot` lands focus.
 *
 * The card factory is registered as standard DOM-authority — content-
 * owning classification comes from the test seeding `bag.content`
 * (any non-undefined value flips `isContentOwning` in focus-transfer.ts).
 * The factory ignores the seeded content; FileBlock has its own state
 * preservation and doesn't need anything plumbed through bag.content.
 *
 * The file content is long enough that "lorem" matches multiple lines —
 * gives the find row's match-count display something to land on
 * (`N matches`).
 *
 * @module components/tugways/cards/gallery-file-block-find-fixture
 */

import React from "react";

import { FileBlock, type FileData } from "@/components/tugways/body-kinds/file-block";

const FIND_FIXTURE_CONTENT = Array.from(
  { length: 120 },
  (_, i) =>
    `line ${String(i + 1).padStart(3, "0")}: lorem ipsum dolor sit amet, consectetur adipiscing elit`,
).join("\n");

const FIND_FIXTURE_DATA: FileData = {
  filePath: "/tmp/test-fixture/lorem.txt",
  content: FIND_FIXTURE_CONTENT,
};

/**
 * Stable preservation key (consumed by tests). The find session's
 * preservation slot is `<key>/file-block-find` — see
 * `useBlockFindSession`'s scope composition.
 */
export const GALLERY_FILE_BLOCK_FIND_FIXTURE_KEY = "file-block-find-fixture";

export function GalleryFileBlockFindFixture(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-file-block-find-fixture">
      <FileBlock
        data={FIND_FIXTURE_DATA}
        collapsed={false}
        componentStatePreservationKey={GALLERY_FILE_BLOCK_FIND_FIXTURE_KEY}
      />
    </div>
  );
}
