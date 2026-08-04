/**
 * at0350-cycle-stack-ring.test.ts — ⌘R cycles a slot's stack as a ring, and
 * the chord obeys the user's preference.
 *
 * `Window ▸ Cycle Stack` is the no-look half of the slot-stack surface: it
 * brings a buried pane forward and puts nothing on screen to be read, so the
 * press can be repeated blind. That promise only holds if repeated presses
 * form a RING — every pane in the slot, then home. The naive implementation
 * (raise the pane one below the front) does not: with three panes it ping-pongs
 * between the top two forever and the third is unreachable, because each raise
 * rewrites the very order the "next" was computed from. Raising the BOTTOM-most
 * pane instead — the one buried longest, which is also ⌘`'s convention for
 * windows — makes each raise send the outgoing front pane exactly one place
 * back, so a depth-N slot returns to its starting order after N presses.
 *
 * So the ring is what this file asserts, and it needs three panes to say
 * anything: at depth 2 every candidate rule looks identical. The first test
 * walks all three presses and checks the whole order each time, not just which
 * pane came up — a rule that raised the right pane while scrambling the ones
 * behind it would pass a front-only assertion and then fail on press four.
 *
 * The second test is about the chord's OWNER. ⌘R belongs to whichever of the
 * two slot-stack items the user names; both items always exist and gate
 * identically, and only the key equivalent moves. It has to move on the host
 * side — AppKit resolves a menu key equivalent before the WKWebView sees the
 * keydown, so no amount of frontend routing could reassign it — which makes
 * "the preference actually reached the menu bar" a round-trip fact worth
 * pinning: set it to `reveal`, press ⌘R, and the stack must NOT have moved
 * (the picker opens instead, which at0348 owns).
 *
 * Why z-index and not occlusion: the three panes are given different widths so
 * none is fully covered, because a covered pane is stamped
 * `data-occluded="true"` and hidden — which would make "did it come forward"
 * unreadable for the two panes that are not front. The frames' computed
 * z-index is the deck's own projection of `DeckState.panes` order, so reading
 * it reads the real thing.
 *
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/action-dispatch.ts
 * @covers tugdeck/src/components/tugways/action-vocabulary.ts
 * @covers tugdeck/src/stack-chord-store.ts
 * @covers tugdeck/src/lib/host-menu-state.ts
 * @covers tugapp/Sources/AppDelegate.swift
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

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

async function pressCycle(app: App): Promise<void> {
  await app.nativeKey("r", ["cmd"]);
  await new Promise<void>((r) => setTimeout(r, AFTER_CHORD_MS));
}

describe.skipIf(!SHOULD_RUN)(
  "at0350 — Cycle Stack walks the slot as a ring",
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
          await pressCycle(app);
          const first = await stackOrder(app);
          note("at0350 after press 1", first.join(" > "));
          expect(first, "the back pane came forward").toEqual(["p0", "p2", "p1"]);
          await app.expectFocusedCard("Z", { timeoutMs: 5_000 });

          // Press 2 — answered by the pane that just came up, reading its own
          // freshly-ordered stack. The one it raises is the next one round.
          await pressCycle(app);
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
          await pressCycle(app);
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
      "handing ⌘R to Reveal Stack takes it away from Cycle Stack",
      async () => {
        const app = await launchTugApp({ testName: "at0350-cycle-chord-pref" });
        try {
          await seed(app);

          const cycle = await app.menuItemState("window.cycleStack");
          expect(cycle.found, "window.cycleStack exists in the menu bar").toBe(true);
          expect(cycle.enabled, "a 3-deep slot has somewhere to cycle to").toBe(true);

          // The preference reaches the menu bar over the menu-state push, the
          // same channel the enablement rides; give the round-trip room.
          await app.evalJS<null>(`(window.__tug.setStackChord("reveal"), null)`);
          await new Promise<void>((r) => setTimeout(r, 400));

          const before = await stackOrder(app);
          await pressCycle(app);
          const after = await stackOrder(app);
          note("at0350 under the reveal preference", `${before.join(" > ")} -> ${after.join(" > ")}`);
          expect(after, "⌘R no longer cycles once the chord is given away").toEqual(
            before,
          );

          // And it is still a live command — only its chord went elsewhere.
          const stillThere = await app.menuItemState("window.cycleStack");
          expect(stillThere.found, "Cycle Stack stays in the menu").toBe(true);
          expect(stillThere.enabled, "and stays enabled — only the chord moved").toBe(
            true,
          );
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
