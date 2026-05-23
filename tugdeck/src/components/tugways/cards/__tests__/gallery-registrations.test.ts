/**
 * Pure-logic coverage for the Tide assistant-rendering gallery cards
 * shipped in batch 1 ([#step-14-5]).
 *
 * The cards themselves are static composition over module-scope mock
 * data — there is no branching logic to pin. What *is* a pure-logic
 * concern, and what this file guards, is the **registry wiring**: each
 * batch-1 card must be registered in the global card registry with a
 * `contentFactory` and sane `defaultMeta`, so it is reachable from the
 * gallery's [+] type picker. A card file that exists but is never
 * wired into `gallery-registrations.tsx` is the bug this catches.
 *
 * The render-half of the step's verification — that each card mounts
 * without throwing under both themes, paints no `[object Object]`, and
 * (for tool-block cards) emits exactly one `[data-slot$="-tool-block"]`
 * element per `tool_use` — needs a real render surface and lives in
 * `tests/app-test/at0082-gallery-shipped-renderers.test.ts`, which
 * drives the cards through the running app.
 */

import { beforeAll, describe, expect, test } from "bun:test";

import {
  _resetForTest,
  getRegistration,
} from "@/card-registry";
import { registerGalleryCards } from "../gallery-registrations";

// ---------------------------------------------------------------------------
// The batch-1 cards: new componentIds created by #step-14-5.
// ---------------------------------------------------------------------------

/** Component ids #step-14-5 adds, with the title each should carry. */
const BATCH_1_CARDS: ReadonlyArray<{ componentId: string; title: string }> = [
  { componentId: "gallery-tide-thinking", title: "TideThinkingBlock" },
  { componentId: "gallery-json-tree-block", title: "JsonTreeBlock" },
  { componentId: "gallery-tool-block-file", title: "File Tool Blocks" },
  { componentId: "gallery-tool-block-default", title: "DefaultToolBlock" },
];

/**
 * The existing cards #step-14-5 verifies / extends (does not recreate).
 * They were registered during Step 10.9; the audit pass must leave
 * them registered.
 */
const EXTENDED_CARDS: ReadonlyArray<string> = [
  "gallery-bash-tool-block",
  "gallery-pinned-headers",
  "gallery-markdown-view",
];

// ---------------------------------------------------------------------------
// Hermetic registry — bun shares module state across test files, so
// reset and re-register from scratch.
// ---------------------------------------------------------------------------

beforeAll(() => {
  _resetForTest();
  registerGalleryCards();
});

describe("#step-14-5 gallery cards — registry wiring", () => {
  for (const { componentId, title } of BATCH_1_CARDS) {
    test(`${componentId} is registered with a contentFactory and defaultMeta`, () => {
      const registration = getRegistration(componentId);
      expect(registration, `${componentId} must be registered`).toBeDefined();
      // `contentFactory` is what `DeckCanvas` calls to mount the card —
      // a registration without one is unreachable.
      expect(typeof registration?.contentFactory).toBe("function");
      expect(registration?.defaultMeta.title).toBe(title);
      // Gallery cards are developer-family and closable.
      expect(registration?.family).toBe("developer");
      expect(registration?.defaultMeta.closable).toBe(true);
    });
  }

  test("the verified/extended cards remain registered", () => {
    for (const componentId of EXTENDED_CARDS) {
      expect(
        getRegistration(componentId),
        `${componentId} must still be registered after the batch-1 audit pass`,
      ).toBeDefined();
    }
  });

  test("each batch-1 contentFactory is a distinct registration", () => {
    const factories = BATCH_1_CARDS.map(
      ({ componentId }) => getRegistration(componentId)?.contentFactory,
    );
    const unique = new Set(factories);
    expect(unique.size).toBe(BATCH_1_CARDS.length);
  });
});
