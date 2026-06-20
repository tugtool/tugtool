/**
 * Pure-logic coverage for the Dev assistant-rendering gallery cards
 * shipped in batch 2 ([#step-29-5]).
 *
 * Same wiring contract as the batch-1 test: each card must be
 * registered with a `contentFactory`, sane `defaultMeta`, and the
 * developer family. The render-half of the verification lives in the
 * gallery cards themselves (visual check under both themes).
 *
 * Batch 2 covers the components shipped in Steps 25–29:
 *
 *  - `WebFetchToolBlock`, `WebSearchToolBlock` — the standalone
 *    `gallery-tool-block-network` / `gallery-tool-block-search` demo cards
 *    were retired in the block-renderer consolidation (their tools still
 *    render through the dispatch; the gallery no longer keeps a card per tool)
 *  - `WriteToolBlock`, `NotebookEditToolBlock`
 *    → extension of `gallery-tool-block-file` (Read + Edit + Write +
 *    NotebookEdit) — not a separate registration, verified at the
 *    component-content level
 *  - Step 27 — `ImageBlock` → `gallery-image-block`
 *  - Step 28 — TableBlock attempt reverted; no gallery card today
 *  - Step 29 — `SessionInitBanner`, `ErrorBlock`, `CautionBadge`
 *    → `gallery-dev-chrome`
 */

import { beforeAll, describe, expect, test } from "bun:test";

import {
  _resetForTest,
  getRegistration,
} from "@/card-registry";
import { registerGalleryCards } from "../gallery-registrations";

/** Component ids #step-29-5 adds. */
const BATCH_2_CARDS: ReadonlyArray<{ componentId: string; title: string }> = [
  { componentId: "gallery-image-block", title: "ImageBlock" },
  {
    componentId: "gallery-dev-chrome",
    title: "Dev Chrome (banner / error / caution)",
  },
];

beforeAll(() => {
  _resetForTest();
  registerGalleryCards();
});

describe("#step-29-5 gallery cards — registry wiring", () => {
  for (const { componentId, title } of BATCH_2_CARDS) {
    test(`${componentId} is registered with a contentFactory and defaultMeta`, () => {
      const registration = getRegistration(componentId);
      expect(
        registration,
        `${componentId} must be registered`,
      ).toBeDefined();
      expect(typeof registration?.contentFactory).toBe("function");
      expect(registration?.defaultMeta.title).toBe(title);
      expect(registration?.family).toBe("developer");
      expect(registration?.defaultMeta.closable).toBe(true);
    });
  }

  test("each batch-2 contentFactory is a distinct registration", () => {
    const factories = BATCH_2_CARDS.map(
      ({ componentId }) => getRegistration(componentId)?.contentFactory,
    );
    const unique = new Set(factories);
    expect(unique.size).toBe(BATCH_2_CARDS.length);
  });
});
