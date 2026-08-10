/**
 * at0389-resume-session-neighbor-slot.test.ts — a resumed session opens beside
 * the card that named it.
 *
 * `Resume Session` — the session identity menu's lead item once no card holds
 * the session — used to add its card at the head of the arrangement, however
 * far that was from the row the reader right-clicked. A session named in a
 * commit row is being read *there*, so the card that answers belongs there too:
 * the same rule a file link opens under (at0369), now shared by both openers
 * through `lib/neighbor-slot.ts`.
 *
 * Driven through the real `resume-session` registry handler — the one the menu
 * item calls — against a deck with a live arrangement:
 *
 *  1. **Left, by default.** A resume named by the card in slot 3 lands in
 *     slot 2.
 *  2. **The named card wins over the focused one.** `originCardId` is the
 *     menu's host card, because a right-click need not have moved first
 *     responder; a dispatch that names one is placed beside it and not beside
 *     whoever holds focus.
 *  3. **Right, when there is no left.** From the leftmost slot the card takes
 *     the slot to the immediate right rather than landing on its opener.
 *
 * The assertion is the stored slot of the pane holding the new session card,
 * read from the deck's own diagnostic snapshot — the number the imposer
 * resolves geometry from, not a measured frame. That the *restore* then
 * succeeds is another test's subject: an app-test ledger row has no JSONL
 * behind it, so the fresh card is rightly on its way to the picker.
 *
 * @covers tugdeck/src/lib/neighbor-slot.ts
 * @covers tugdeck/src/action-dispatch.ts
 * @covers tugdeck/src/components/tugways/session-identity-menu.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "c4d5e6f7-2b3c-4d5e-9f60-6b7c8d9e0f13";
const PROJECT_DIR = "/Users/tester/src/tugtool";

/**
 * Two placeholder cards in the outer slots of a four-up deck. The origin card
 * `B` sits at slot 3 (stored 2) so the first resume has room to walk left twice
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

const sessionCardIds = (app: App): Promise<string[]> =>
  app.evalJS<string[]>(
    `window.tugdeck.diag.getDeckState().cards
      .filter(function (c) { return c.componentId === "session"; })
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
 * Resume the session and answer with the id of the session card that appeared
 * for it — the one id the deck gained. `originCardId` is omitted exactly as a
 * dispatch with no named host omits it, so the fallback is exercised as
 * itself.
 */
async function resumeAndCatchCard(
  app: App,
  originCardId?: string,
): Promise<string> {
  const before = await sessionCardIds(app);
  await app.dispatchControlAction("resume-session", {
    sessionId: SESSION_ID,
    projectDir: PROJECT_DIR,
    ...(originCardId === undefined ? {} : { originCardId }),
  });
  await app.waitForCondition<boolean>(
    `window.tugdeck.diag.getDeckState().cards.filter(function (c) {
      return c.componentId === "session";
    }).length === ${before.length + 1}`,
    { timeoutMs: 15_000 },
  );
  const after = await sessionCardIds(app);
  const fresh = after.filter((id) => !before.includes(id));
  expect(fresh).toHaveLength(1);
  return fresh[0];
}

describe.skipIf(!SHOULD_RUN)(
  "at0389 — a resumed session lands in the slot beside the card that named it",
  () => {
    test(
      "left of the naming card, and right of it when there is no left",
      async () => {
        const app = await launchTugApp({
          testName: "at0389-resume-session-neighbor-slot",
        });
        try {
          await app.seedDeckState({ state: DECK, focusCardId: "A" });
          expect(await app.getActiveCardId()).toBe("A");

          // ── 1 & 2. The menu's host card is `B` at slot 3 (stored 2) while
          // focus is on `A` at slot 0 — the shape a right-click leaves behind.
          // The resume follows the card that NAMED the session, so it lands
          // left of B rather than beside the focused card. ──────────────────
          const first = await resumeAndCatchCard(app, "B");
          expect(await slotOf(app, first)).toBe(1);

          // ── The fresh card holds focus, so an unnamed dispatch walks one
          // further left: no origin named means whoever is holding it. ──────
          expect(await app.getActiveCardId()).toBe(first);
          const second = await resumeAndCatchCard(app);
          expect(await slotOf(app, second)).toBe(0);

          // ── 3. From the leftmost slot there is nothing to the left, so the
          // card goes right — never on top of the card that opened it. ──────
          expect(await app.getActiveCardId()).toBe(second);
          const third = await resumeAndCatchCard(app);
          expect(await slotOf(app, third)).toBe(1);

          // The seeded cards never moved: a resume places the new card and
          // touches no one else's slot.
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
