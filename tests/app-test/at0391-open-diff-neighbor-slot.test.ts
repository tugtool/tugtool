/**
 * at0391-open-diff-neighbor-slot.test.ts — a popped-out diff lands beside the
 * card it came from, and says so.
 *
 * The third opener in the family (at0369 the file, at0389 the session): a diff
 * popped out of a changeset row used to join at the head of the arrangement,
 * however far that was from the row that was pressed. All three now share
 * `lib/neighbor-slot.ts` and `lib/flash-pane-border.ts`, so what is left to
 * gate here is that this opener is wired to both.
 *
 * Driven through the real `open-diff` registry handler against a four-up deck:
 *
 *  1. **Left of the card that popped it.** The origin is the first responder —
 *     the card holding the changeset row — and the diff takes the slot to its
 *     immediate left.
 *  2. **The REUSE path flashes too.** Descriptor-keyed reuse raises a card
 *     that is already on screen, which is the case with no other sign at all:
 *     nothing moves, nothing appears, and without the ring a second press
 *     reads as a press that did nothing. The first flash is waited OUT before
 *     the second press, so the ring being there afterwards is the second one.
 *  3. **And it is a reuse** — the deck gains no card.
 *
 * The diff itself never resolves: the descriptor names a directory no tugcast
 * serves, so the card mounts and reports it. What is under test is where the
 * card goes and whether it announces itself, both of which precede the round
 * trip.
 *
 * @covers tugdeck/src/lib/open-diff-in-card.ts
 * @covers tugdeck/src/lib/neighbor-slot.ts
 * @covers tugdeck/src/lib/flash-pane-border.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/** A whole-tree diff for a project no tugcast in this launch serves. */
const DESCRIPTOR = { kind: "head", root: "/Users/tester/src/tugtool" };

/**
 * Two placeholder cards in the outer slots of a four-up deck, with the origin
 * `B` at slot 3 (stored 2) so there is a slot to its left to land in.
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

const diffCardIds = (app: App): Promise<string[]> =>
  app.evalJS<string[]>(
    `window.tugdeck.diag.getDeckState().cards
      .filter(function (c) { return c.componentId === "diff"; })
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

/** Whether the pane holding `cardId` is wearing the flash right now. */
const flashOn = (cardId: string): string =>
  `(function () {
    var pane = window.tugdeck.diag.getDeckState().panes.find(function (p) {
      return p.cardIds.indexOf(${JSON.stringify(cardId)}) !== -1;
    });
    if (pane === undefined) return false;
    var el = document.querySelector('.tug-pane[data-pane-id="' + pane.id + '"]');
    return el !== null && el.classList.contains("tug-pane-flash");
  })()`;

describe.skipIf(!SHOULD_RUN)(
  "at0391 — a popped-out diff lands beside its opener and flashes",
  () => {
    test(
      "left of the card that opened it, and the reused card flashes again",
      async () => {
        const app = await launchTugApp({
          testName: "at0391-open-diff-neighbor-slot",
        });
        try {
          await app.seedDeckState({ state: DECK, focusCardId: "B" });
          expect(await app.getActiveCardId()).toBe("B");
          expect(await diffCardIds(app)).toHaveLength(0);

          // ── 1. Beside the card that popped it, not at the head. ───────────
          await app.dispatchControlAction("open-diff", {
            descriptor: DESCRIPTOR,
          });
          await app.waitForCondition<boolean>(
            `window.tugdeck.diag.getDeckState().cards.filter(function (c) {
              return c.componentId === "diff";
            }).length === 1`,
            { timeoutMs: 15_000 },
          );
          const [diffCard] = await diffCardIds(app);
          expect(await slotOf(app, diffCard)).toBe(1);

          // …and it announced itself. The poll, not a sample: the card is
          // added before React has committed its pane, and the flash lands on
          // the deferred retry that follows the commit.
          await app.waitForCondition<boolean>(flashOn(diffCard), {
            timeoutMs: 1_200,
          });

          // ── 2. Wait the ring OUT, so what follows cannot be this one. ─────
          await app.waitForCondition<boolean>(
            `!(${flashOn(diffCard)})`,
            { timeoutMs: 5_000 },
          );

          // The same descriptor again: descriptor-keyed reuse raises the card
          // that is already open — and flashes it, since a raise of a card
          // already on screen has no other sign.
          await app.dispatchControlAction("open-diff", {
            descriptor: DESCRIPTOR,
          });
          await app.waitForCondition<boolean>(flashOn(diffCard), {
            timeoutMs: 1_200,
          });

          // ── 3. Reuse, not a second card — and nobody else moved. ──────────
          expect(await diffCardIds(app)).toEqual([diffCard]);
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
