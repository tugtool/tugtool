/**
 * at0350-cycle-stack-ring.test.ts — ⌥⌘] / ⌥⌘[ rotate a slot's stack as a
 * ring, and the two directions are exact inverses.
 *
 * `Window ▸ Next Card in Stack` is the no-look half of the slot-stack
 * surface: it brings a buried pane forward and puts nothing on screen to be
 * read, so the press can be repeated blind. That promise only holds if
 * repeated presses form a RING — every pane in the slot, then home. The
 * naive implementation (raise the pane one below the front) does not: with
 * three panes it ping-pongs between the top two forever and the third is
 * unreachable, because each raise rewrites the very order the "next" was
 * computed from. Raising the BOTTOM-most pane instead — the one buried
 * longest, which is also ⌘`'s convention for windows — makes each raise send
 * the outgoing front pane exactly one place back, so a depth-N slot returns
 * to its starting order after N presses.
 *
 * So the ring is what this file asserts, and it needs three panes to say
 * anything: at depth 2 every candidate rule looks identical. The first test
 * walks all three presses and checks the whole order each time, not just which
 * pane came up — a rule that raised the right pane while scrambling the ones
 * behind it would pass a front-only assertion and then fail on press four.
 *
 * The second test is the other direction. `Previous Card in Stack` must be
 * NEXT's true inverse — the front pane goes all the way to the back and the
 * one beneath it fronts — because the tempting implementation (raise the
 * second-from-top) is exactly the ping-pong rule ruled out above, just
 * wearing the other label. Depth 3 exposes it the same way: previous → next
 * must be a no-op, and three previouses must also come home.
 *
 * Why z-index and not occlusion: the three panes are given different widths so
 * none is fully covered, because a covered pane is stamped
 * `data-occluded="true"` and hidden — which would make "did it come forward"
 * unreadable for the two panes that are not front. The frames' computed
 * z-index is the deck's own projection of `DeckState.panes` order, so reading
 * it reads the real thing.
 *
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/deck-manager.ts
 * @covers tugdeck/src/action-dispatch.ts
 * @covers tugdeck/src/components/tugways/action-vocabulary.ts
 * @covers tugdeck/src/lib/host-menu-state.ts
 * @covers tugapp/Sources/AppDelegate.swift
 */

import { describe, expect, test } from "bun:test";

import {
  launchTugApp,
  note,
  type App,
  type MenuItemState,
} from "./_harness";

/**
 * Assert an item is in the menu bar, and narrow to the found shape so its
 * enablement is readable — `expect(...).toBe(true)` checks a value but tells
 * the compiler nothing about the union.
 */
function inMenuBar(
  state: MenuItemState,
  label: string,
): Extract<MenuItemState, { found: true }> {
  if (!state.found) throw new Error(`${label} is not in the menu bar`);
  return state;
}

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const LENS_WIDTH = 300;
const AFTER_LAND_MS = 900;
/** Room for the chain round-trip and the deck's re-render after a raise. */
const AFTER_CHORD_MS = 500;

function card(id: string, title: string) {
  return { id, componentId: "gallery-accordion", title, closable: true };
}

function pane(id: string, cardId: string, width: number, slot?: number) {
  return {
    id,
    position: { x: 40, y: 40 },
    size: { width, height: 400 },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["maker"],
    ...(slot === undefined ? {} : { slot }),
  };
}

/**
 * Three panes in slot 0 — p0/Z at the back, then p1/A, then p2/B in front —
 * plus the Lens. Descending widths keep every one of them visible, so all
 * three z-indices stay readable through the whole cycle.
 */
function deckShape() {
  return {
    cards: [
      card("Z", "Card Z"),
      card("A", "Card A"),
      card("B", "Card B"),
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      pane("p0", "Z", 560, 0),
      pane("p1", "A", 500, 0),
      pane("p2", "B", 440, 0),
      {
        id: "pLens",
        position: { x: 0, y: 0 },
        size: { width: LENS_WIDTH, height: 900 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Lens",
        acceptsFamilies: [],
      },
    ],
    activePaneId: "p2",
    imposition: { kind: "three-up", lens: "right" },
    hasFocus: true,
  };
}

/** The slot's pane ids, front first, read from the deck's own z projection. */
async function stackOrder(app: App): Promise<string[]> {
  return app.evalJS<string[]>(
    `["p0", "p1", "p2"]
      .map(function (id) {
        var el = document.querySelector(".tug-pane[data-pane-id=\\"" + id + "\\"]");
        return { id: id, z: Number(getComputedStyle(el).zIndex) };
      })
      .sort(function (a, b) { return b.z - a.z; })
      .map(function (e) { return e.id; })`,
  );
}

async function seed(app: App): Promise<void> {
  await app.seedDeckState({ state: deckShape(), focusCardId: "B" });
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('.tug-pane[data-pane-id]').length === 4`,
    { timeoutMs: 5_000 },
  );
  await new Promise<void>((r) => setTimeout(r, AFTER_LAND_MS));
}

async function pressNext(app: App): Promise<void> {
  await app.nativeKey("]", ["cmd", "alt"]);
  await new Promise<void>((r) => setTimeout(r, AFTER_CHORD_MS));
}

async function pressPrevious(app: App): Promise<void> {
  await app.nativeKey("[", ["cmd", "alt"]);
  await new Promise<void>((r) => setTimeout(r, AFTER_CHORD_MS));
}

describe.skipIf(!SHOULD_RUN)(
  "at0350 — Next/Previous Card in Stack walk the slot as a ring",
  () => {
    test(
      "three presses visit every pane and land back where they started",
      async () => {
        const app = await launchTugApp({ testName: "at0350-cycle-ring" });
        try {
          await seed(app);

          const start = await stackOrder(app);
          expect(start, "seeded front-to-back").toEqual(["p2", "p1", "p0"]);

          // Press 1 — the pane buried longest comes to the front, and the two
          // it passed keep their order relative to each other.
          await pressNext(app);
          const first = await stackOrder(app);
          note("at0350 after press 1", first.join(" > "));
          expect(first, "the back pane came forward").toEqual(["p0", "p2", "p1"]);
          await app.expectFocusedCard("Z", { timeoutMs: 5_000 });

          // Press 2 — answered by the pane that just came up, reading its own
          // freshly-ordered stack. The one it raises is the next one round.
          await pressNext(app);
          const second = await stackOrder(app);
          note("at0350 after press 2", second.join(" > "));
          expect(second, "the next one round, not a ping-pong back to p2").toEqual([
            "p1",
            "p0",
            "p2",
          ]);
          await app.expectFocusedCard("A", { timeoutMs: 5_000 });

          // Press 3 — home. This is the whole promise of a no-look chord: N
          // presses in a depth-N slot is a no-op, so the user can count
          // instead of look.
          await pressNext(app);
          const third = await stackOrder(app);
          note("at0350 after press 3", third.join(" > "));
          expect(third, "a depth-3 slot is home after 3 presses").toEqual(start);
          await app.expectFocusedCard("B", { timeoutMs: 5_000 });
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "⌥⌘[ is ⌥⌘]'s exact inverse, and walks the ring backwards",
      async () => {
        const app = await launchTugApp({ testName: "at0350-stack-previous" });
        try {
          await seed(app);

          const item = inMenuBar(
            await app.menuItemState("window.previousCardInStack"),
            "window.previousCardInStack",
          );
          expect(item.enabled, "a 3-deep slot has somewhere to rotate to").toBe(true);

          const start = await stackOrder(app);
          expect(start, "seeded front-to-back").toEqual(["p2", "p1", "p0"]);

          // Previous — the front pane goes all the way to the back and the
          // one beneath it fronts. Raising the second-from-top instead would
          // leave p2 second rather than last, so the whole order is asserted.
          await pressPrevious(app);
          const backedUp = await stackOrder(app);
          note("at0350 after ⌥⌘[", backedUp.join(" > "));
          expect(backedUp, "the front pane went to the back").toEqual([
            "p1",
            "p0",
            "p2",
          ]);
          await app.expectFocusedCard("A", { timeoutMs: 5_000 });

          // Next — and it undoes it. The inverse pair is the whole point of
          // splitting the old one-direction cycle in two.
          await pressNext(app);
          const home = await stackOrder(app);
          note("at0350 after ⌥⌘[ ⌥⌘]", home.join(" > "));
          expect(home, "next undoes previous exactly").toEqual(start);
          await app.expectFocusedCard("B", { timeoutMs: 5_000 });

          // Backwards ring: three previouses visit every pane and come home.
          await pressPrevious(app);
          await pressPrevious(app);
          const twoBack = await stackOrder(app);
          note("at0350 after two ⌥⌘[", twoBack.join(" > "));
          expect(twoBack, "two back = one forward in a depth-3 ring").toEqual([
            "p0",
            "p2",
            "p1",
          ]);
          await pressPrevious(app);
          const roundTrip = await stackOrder(app);
          note("at0350 after three ⌥⌘[", roundTrip.join(" > "));
          expect(roundTrip, "a depth-3 slot is home after 3 presses").toEqual(start);
          await app.expectFocusedCard("B", { timeoutMs: 5_000 });
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
