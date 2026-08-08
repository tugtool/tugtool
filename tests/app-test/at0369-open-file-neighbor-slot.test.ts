/**
 * at0369-open-file-neighbor-slot.test.ts — a file opens next to the card that
 * named it.
 *
 * Under a multi-slot arrangement every newly added card used to join at the
 * first slot, which is the right answer for a card arriving from nowhere and
 * the wrong one for a file opened from a link: the passage being read and the
 * file it cites could end up a whole deck apart, which is exactly the reading
 * the click was asking for. `openFileInCard` now names the slot beside the
 * originating card, and `addCard` places the card there.
 *
 * The rule and its fallback, driven through the real `open-file` control
 * action against real files on disk:
 *
 *  1. **Left, by default.** A file opened from a card in slot 3 lands in
 *     slot 2 — the slot to its immediate left.
 *  2. **It composes.** Opening again from that freshly-opened card walks one
 *     more slot left, because the rule reads the originating card's slot and
 *     the newly-opened card is the one now holding focus.
 *  3. **Right, when there is no left.** From the leftmost slot there is no
 *     slot to the left, so the file takes the one to the immediate right
 *     rather than landing on top of the card that opened it.
 *
 * The assertion is on the stored slot of the pane holding the new card, read
 * back through the deck's own diagnostic snapshot — the number the imposer
 * resolves geometry from, not a measured frame.
 *
 * @covers tugdeck/src/lib/open-file-in-card.ts
 */

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/**
 * Two placeholder cards in the outer slots of a four-up deck. The origin card
 * `B` sits at slot 3 (stored 2) so the first open has room to walk left twice
 * before it runs out of deck.
 */
const DECK = {
  cards: [
    { id: "A", componentId: "hello", title: "Card A", closable: true },
    { id: "B", componentId: "hello", title: "Card B", closable: true },
  ],
  panes: [
    {
      id: "pA",
      position: { x: 40, y: 40 },
      size: { width: 360, height: 400 },
      cardIds: ["A"],
      activeCardId: "A",
      title: "",
      acceptsFamilies: ["maker"],
      slot: 0,
    },
    {
      id: "pB",
      position: { x: 420, y: 40 },
      size: { width: 360, height: 400 },
      cardIds: ["B"],
      activeCardId: "B",
      title: "",
      acceptsFamilies: ["maker"],
      slot: 2,
    },
  ],
  activePaneId: "pB",
  imposition: { kind: "four-up" },
  hasFocus: true,
};

const textCardIds = (app: App): Promise<string[]> =>
  app.evalJS<string[]>(
    `window.tugdeck.diag.getDeckState().cards
      .filter(function (c) { return c.componentId === "text"; })
      .map(function (c) { return c.id; })`,
  );

/** The stored slot of the pane holding `cardId`; null when it holds none. */
const slotOf = (app: App, cardId: string): Promise<number | null> =>
  app.evalJS<number | null>(
    `(function () {
      var pane = window.tugdeck.diag.getDeckState().panes.find(function (p) {
        return p.cardIds.indexOf(${JSON.stringify(cardId)}) !== -1;
      });
      return pane === undefined || pane.slot === undefined ? null : pane.slot;
    })()`,
  );

/**
 * Open `file` and answer with the id of the Text card that appeared for it —
 * the one id the deck gained. Waiting on the count rather than a fixed delay
 * keeps the read off the frame the card mounts on.
 */
async function openAndCatchCard(app: App, file: string): Promise<string> {
  const before = await textCardIds(app);
  await app.dispatchControlAction("open-file", { path: file });
  await app.waitForCondition<boolean>(
    `window.tugdeck.diag.getDeckState().cards.filter(function (c) {
      return c.componentId === "text";
    }).length === ${before.length + 1}`,
    { timeoutMs: 15_000 },
  );
  const after = await textCardIds(app);
  const fresh = after.filter((id) => !before.includes(id));
  expect(fresh).toHaveLength(1);
  return fresh[0];
}

describe.skipIf(!SHOULD_RUN)(
  "at0369 — an opened file lands in the slot beside its opener",
  () => {
    test(
      "left of the originating card, and right of it when there is no left",
      async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0369-"));
        const files = ["one", "two", "three"].map((name) => {
          const file = path.join(dir, `${name}.txt`);
          fs.writeFileSync(file, `${name}\n`);
          return file;
        });

        const app = await launchTugApp({
          testName: "at0369-open-file-neighbor-slot",
        });
        try {
          await app.seedDeckState({ state: DECK, focusCardId: "B" });
          expect(await app.getActiveCardId()).toBe("B");

          // ── 1. The origin holds slot 3 (stored 2); the file takes slot 3's
          // left-hand neighbour rather than the head of the arrangement. ────
          const first = await openAndCatchCard(app, files[0]);
          expect(await slotOf(app, first)).toBe(1);

          // ── 2. That card is now the first responder, so opening from it
          // walks one further left. The rule reads whoever opened the file,
          // not whoever opened the deck. ────────────────────────────────────
          expect(await app.getActiveCardId()).toBe(first);
          const second = await openAndCatchCard(app, files[1]);
          expect(await slotOf(app, second)).toBe(0);

          // ── 3. From the leftmost slot there is nothing to the left, so the
          // file goes right — never on top of the card that opened it. ──────
          expect(await app.getActiveCardId()).toBe(second);
          const third = await openAndCatchCard(app, files[2]);
          expect(await slotOf(app, third)).toBe(1);

          // The seeded cards never moved: opening a file places the new card
          // and touches no one else's slot.
          expect(await slotOf(app, "A")).toBe(0);
          expect(await slotOf(app, "B")).toBe(2);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
