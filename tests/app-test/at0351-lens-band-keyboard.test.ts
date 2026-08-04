/**
 * at0351-lens-band-keyboard.test.ts — a Lens section band is a place the
 * keyboard can go, and its fold chevron is a stop beside it.
 *
 * ## What this gates (failure modes, not busywork)
 *
 *   - **The band is in the walk (A):** arrowing UP off the top of the Cards
 *     list crosses out of the list along the liveliness net and lands, past the
 *     filter field, on the BAND — which wears the ring. Fails if the band
 *     registers no focusable, or registers one ordered behind the body (the
 *     walk would then run band-after-rows and the eye and the keyboard would
 *     disagree about which section they are in).
 *   - **The chevron is a stop beside it (B):** arrowing back DOWN along the
 *     band reaches its fold cue before it reaches the list. Fails if the cue is
 *     left an un-authored native button — reachable by nothing, since the Lens
 *     grants no DOM focus.
 *   - **Space folds and unfolds (C):** on the chevron, Space collapses the
 *     section and Space again opens it. This is the whole point of the other
 *     two: without a keyboard route to the chevron there is no keyboard way to
 *     close a Lens section at all.
 *   - **A folded section is still reachable (D):** its body is gone, so its
 *     band and chevron are the only stops it has left — and they are enough to
 *     get back in.
 *
 * @covers tugdeck/src/components/lens/lens-section-band.tsx
 * @covers tugdeck/src/components/lens/lens-section-registry.ts
 * @covers tugdeck/src/components/tugways/body-kinds/affordances/block-fold-cue.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARDS_SECTION = '.lens-section[data-lens-section="cards"]';
const CARDS_BODY = `${CARDS_SECTION} [data-testid="lens-section-body"]`;
const CARDS_LIST = ".lens-cards-list";

/** The band's stops, by their stable authored focus keys ([Q12]). */
const BAND_KEY = "lens-section-cards:-2";
const FOLD_KEY = "lens-section-cards:-0.5";
const LIST_KEY = "lens-section-cards:0";

/** The focus key the ring currently rests on, or "" when it rests nowhere. */
const KEY_VIEW_KEY = `(function(){
  var el = document.querySelector("[data-key-view]");
  return el === null ? "" : (el.getAttribute("data-tug-focus-key") || "?");
})()`;

/** Whether the Cards band itself wears the keyboard ring. */
const BAND_RINGS = `document.querySelector('${CARDS_SECTION} > .tool-call-header[data-key-view-kbd]') !== null`;

const CARDS_COLLAPSED = `document.querySelector('${CARDS_SECTION}').getAttribute("data-collapsed")`;

/**
 * Press `key` up to `limit` times, stopping as soon as the ring rests on
 * `target`. Returns the keys the ring visited, so a failure reads as the route
 * it actually took rather than as a bare timeout.
 */
async function arrowUntil(
  app: App,
  key: string,
  target: string,
  limit: number,
): Promise<string[]> {
  const visited: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    await app.nativeKey(key);
    const at = await app.evalJS<string>(KEY_VIEW_KEY);
    visited.push(at);
    if (at === target) break;
  }
  return visited;
}

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 60, y: 60 },
        size: { width: 520, height: 420 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pA",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("at0351 — the Lens band under the keyboard", () => {
  test(
    "the band and its fold chevron are arrow-reachable, and Space folds the section",
    async () => {
      const app = await launchTugApp({ testName: "at0351-lens-band-keyboard" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 5_000 },
        );
        await app.dispatchControlAction("toggle-lens");
        // ⌘L seeds the ring on the first section with content — the Cards list.
        await app.waitForCondition<boolean>(
          `${KEY_VIEW_KEY} === ${JSON.stringify(LIST_KEY)}`,
          { timeoutMs: 8_000 },
        );

        // (A) Up off the top of the list crosses out of it and reaches the
        // band — the band's own stops are on the way, in reverse (the chevron,
        // then the filter field, which is empty and so hands the arrow straight
        // back), which is why this walks rather than steps once.
        const up = await arrowUntil(app, "ArrowUp", BAND_KEY, 4);
        note("ArrowUp route", up.join(" → "));
        expect(up.at(-1)).toBe(BAND_KEY);
        // And the band SHOWS it — the ring is on the band, not merely recorded
        // against it.
        expect(await app.evalJS<boolean>(BAND_RINGS)).toBe(true);

        // (B) Back down along the band: the fold chevron is a stop of its own,
        // reached before the walk drops into the list.
        const down = await arrowUntil(app, "ArrowDown", FOLD_KEY, 4);
        note("ArrowDown route", down.join(" → "));
        expect(down.at(-1)).toBe(FOLD_KEY);
        expect(down).not.toContain(LIST_KEY);

        // (C) Space on the chevron folds the section: the body goes, and the
        // band says so.
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `document.querySelector('${CARDS_BODY}') === null`,
          { timeoutMs: 5_000 },
        );
        expect(await app.evalJS<string>(CARDS_COLLAPSED)).toBe("true");
        // (D) The folded section kept its chevron — the keyboard is still on
        // it, with nothing else left in the section to be on.
        expect(await app.evalJS<string>(KEY_VIEW_KEY)).toBe(FOLD_KEY);

        // …and Space opens it again, list and all.
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `document.querySelector('${CARDS_LIST}') !== null`,
          { timeoutMs: 5_000 },
        );
        expect(await app.evalJS<string>(CARDS_COLLAPSED)).toBe("false");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
