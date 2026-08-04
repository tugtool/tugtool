/**
 * at0349-stack-picker-foreground.test.ts — Cmd-drag on a title bar still
 * drags, and opens no picker.
 *
 * This is the one assertion in the stack-picker feature that a background
 * window cannot make, which is why it is a file of its own rather than a case
 * in at0347.
 *
 * Cmd-click on a title bar opens the slot-stack picker. Cmd-DRAG must keep
 * meaning what it has always meant: for a free pane, the Mac convention of
 * moving a background window without raising it; for an imposed pane, the
 * gesture that evicts it from its slot. Both survive because the Cmd decision
 * is resolved at the gesture's ENDING — in the drag machine's existing
 * no-travel branch — rather than on the way down, so a drag that travels
 * latches `dragMoved` and never reaches the branch that would open a menu.
 *
 * `dragMoved` is set only inside `applyDragFrame`, which runs from a
 * `requestAnimationFrame` callback. A background app-test window is served no
 * frames. A synthetic Cmd-drag there therefore never registers travel at all:
 * it falls into the no-travel branch and OPENS THE PICKER — so the assertion
 * "the frame moved and no menu is present" would not merely fail in the
 * everyday tier, it would invert, certifying the opposite of the behavior. A
 * test that passes by not running is worse than no test, so this one takes a
 * key window and earns it.
 *
 * @foreground
 *
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const LENS_WIDTH = 300;
const AFTER_LAND_MS = 900;

const MENU = '[data-testid="tug-pane-title-bar-stack-menu"]';

const frame = (paneId: string): string => `.tug-pane[data-pane-id="${paneId}"]`;
const titleBar = (paneId: string): string =>
  `${frame(paneId)} [data-testid="tug-pane-title-bar"]`;

const wait = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * Two panes stacked in slot 0. The front one, p1, is what gets dragged, and it
 * has to be a pane WITH a stack: `revealStack` no-ops below depth 2, so
 * dragging a stackless pane and finding no menu would pass for the wrong
 * reason. Being imposed also makes the drag prove both halves of what Cmd-drag
 * on a title bar means — it moves the pane AND evicts it from its slot.
 */
function deckShape() {
  const card = (id: string, title: string) => ({
    id,
    componentId: "gallery-accordion",
    title,
    closable: true,
  });
  const pane = (
    id: string,
    cardId: string,
    position: { x: number; y: number },
    slot?: number,
  ) => ({
    id,
    position,
    size: { width: 420, height: 400 },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["maker"],
    ...(slot === undefined ? {} : { slot }),
  });
  return {
    cards: [
      card("Z", "Card Z"),
      card("A", "Card A"),
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      pane("p0", "Z", { x: 40, y: 40 }, 0),
      pane("p1", "A", { x: 40, y: 40 }, 0),
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
    activePaneId: "p1",
    imposition: { kind: "three-up", lens: "right" },
    hasFocus: true,
  };
}

async function frameLeft(app: App, paneId: string): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector(${JSON.stringify(frame(paneId))}).getBoundingClientRect().left`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0349 — Cmd-drag a title bar and the pane moves, with no picker in sight",
  () => {
    test(
      "a Cmd-drag past the threshold moves the frame and opens no menu",
      async () => {
        const app = await launchTugApp({
          testName: "at0349-stack-picker-foreground",
          foreground: true,
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('.tug-pane[data-pane-id]').length === 3`,
            { timeoutMs: 5_000 },
          );
          await wait(AFTER_LAND_MS);

          // The badge is up before the drag: p1 shares slot 0 with p0, so a
          // picker EXISTS to be opened by mistake. Dragging a pane with no
          // stack would prove nothing — `revealStack` no-ops below depth 2, so
          // "no menu appeared" would hold for the wrong reason.
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(`${frame("p1")} [data-testid="tug-pane-title-bar-stack-badge"]`)}).length`,
            ),
            "the dragged pane is in a stack, so a picker is genuinely reachable",
          ).toBe(1);

          const before = await frameLeft(app, "p1");

          // `holdModifier` buffers native verbs into one atomic RPC with the
          // modifier already down; `evalJS` is not allowed inside that scope,
          // so the drag's start point is resolved beforehand — and re-resolved
          // here, because the control drag above moved the title bar.
          const from = await app.evalJS<{ x: number; y: number }>(
            `(function () {
              var r = document.querySelector(${JSON.stringify(titleBar("p1"))}).getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            })()`,
          );
          // The delays are load-bearing, not padding. `dragMoved` latches
          // inside `applyDragFrame`, which the drag machine schedules on a
          // `requestAnimationFrame`; a down-move-up burst posted back to back
          // can be consumed without a frame ever running between them, and
          // the gesture would end as a no-travel click — exactly the
          // false-negative this file exists to avoid.
          await app.holdModifier(["cmd"], async (inner) => {
            await inner.rpcCall<void>("nativeDrag", {
              from,
              to: { x: from.x + 180, y: from.y + 40 },
              mouseDownDelayMs: 150,
              mouseUpDelayMs: 150,
            });
          });
          await wait(AFTER_LAND_MS);

          const after = await frameLeft(app, "p1");
          note("at0349 p1 left before → after", `${before} → ${after}`);

          // The drag both moves the pane and evicts it from slot 0 — the two
          // halves of what Cmd-drag on a title bar has always meant.
          expect(after - before, "the Cmd-drag moved the pane").toBeGreaterThan(100);
          expect(
            await app.evalJS<string | null>(
              `document.querySelector(${JSON.stringify(frame("p1"))}).getAttribute("data-imposed")`,
            ),
            "and evicted it from its slot",
          ).toBeNull();
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(MENU)}).length`,
            ),
            "and opened no stack picker — travel latched, so the no-travel branch never ran",
          ).toBe(0);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
