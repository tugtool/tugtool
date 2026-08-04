/**
 * at0348-reveal-stack-chord.test.ts — ⌘R reveals the focused pane's stack,
 * and is silent when there is no stack to reveal.
 *
 * Two things are being proved, and they are different in kind.
 *
 * The GATE is a menu-validation fact. `Window ▸ Reveal Stack` pulls its
 * enablement from a `stackDepth` the frontend publishes on the menu-state
 * payload: the number of panes sharing the FOCUSED pane's slot, and 0 when
 * that pane holds no slot (a free pane, the Lens) or when nothing is selected
 * at all. The item is enabled iff that number exceeds 1. A disabled item is
 * silent; an enabled item that no-ops would beep, or look broken. So the four
 * focus states are walked and `menuItemState` is read at each — the item's
 * live `NSMenuItemValidation` answer, not a stored flag.
 *
 * Notably there is no deselected-deck escape hatch here, unlike the three
 * navigation items beside it in the Window menu (`Previous Card`, `Next
 * Card`, `Cycle Panes` all stay live on a deselected deck so the keyboard can
 * re-enter it). Reveal Stack acts on a SPECIFIC pane's stack; with nothing
 * selected there is no such pane, and a command that quietly picks one for the
 * user is the non-obvious-target failure.
 *
 * The CHORD is a round-trip fact: AppKit resolves the key equivalent before
 * the web view ever sees a keydown, the selector sends a control message, and
 * the action travels the responder chain to the focused pane, which hands it
 * to its title bar. The second press is the interesting one — it CLOSES the
 * picker, and the reason is ordering rather than a race. An open TugPopupMenu
 * subscribes to `observeDispatch` and closes on any chain dispatch that is not
 * its own selection blink, and `REVEAL_STACK` travels the chain, so the
 * chord's own dispatch reaches that observer. `sendToFirstResponder` runs the
 * responder action and THEN notifies observers, and the subscription is gated
 * on the menu being open — so the handle toggles, and both directions are
 * single-valued: open → the toggle queues false, the observer queues false
 * again, it closes; closed → no observer is registered at all, the toggle
 * queues true, it opens.
 *
 * The chord is a PREFERENCE, so the second test sets it before pressing.
 * ⌘R belongs to whichever of the two slot-stack items the user names — Cycle
 * Stack by default, Reveal Stack here — and only the key equivalent moves; both
 * items exist and gate identically either way. That is why the gate test above
 * needs no such setup, and why this one would otherwise be pressing a chord
 * that cycles.
 *
 * What this file deliberately does NOT assert: that ⌘R no longer reloads.
 * at0168 owns that structurally, by identifier and modifier mask. A "press ⌘R
 * and confirm no reload" assertion would be vacuous in this bundle anyway —
 * the Maker menu is hidden unless maker mode is on, and AppKit does not match
 * key equivalents on hidden items, so the pass would prove nothing about the
 * move.
 *
 * @covers tugapp/Sources/AppDelegate.swift
 * @covers tugdeck/src/lib/host-menu-state.ts
 * @covers tugdeck/src/action-dispatch.ts
 * @covers tugdeck/src/components/tugways/action-vocabulary.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const LENS_WIDTH = 300;
const AFTER_LAND_MS = 900;

const MENU = '[data-testid="tug-pane-title-bar-stack-menu"]';

const wait = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * The same shape at0347 uses: a 2-deep slot 0 (p0/Z behind, p1/A in front), a
 * pane alone at slot 2, a free pane, and the Lens — one deck holding every
 * focus state the gate has an answer for.
 */
function deckShape() {
  const card = (id: string, title: string) => ({
    id,
    componentId: "gallery-accordion",
    title,
    closable: true,
  });
  const pane = (id: string, cardId: string, width: number, slot?: number) => ({
    id,
    position: { x: 40, y: 40 },
    size: { width, height: 400 },
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
      card("B", "Card B"),
      card("F", "Card F"),
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      pane("p0", "Z", 520, 0),
      pane("p1", "A", 420, 0),
      pane("p2", "B", 420, 2),
      pane("pFree", "F", 380),
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

/** Focus a card the way the deck itself would, then let the state settle. */
async function focusCard(app: App, cardId: string): Promise<void> {
  await app.evalJS<null>(
    `(window.__tug.dispatchControlAction("focus-session-card", { cardId: ${JSON.stringify(cardId)} }), null)`,
  );
  await app.expectFocusedCard(cardId, { timeoutMs: 5_000 });
  // The menu-state publisher coalesces on a microtask and posts to the host;
  // give the round-trip room before reading the item's validated state.
  await wait(300);
}

async function revealEnabled(app: App): Promise<boolean> {
  const state = await app.menuItemState("window.revealStack");
  expect(state.found, "window.revealStack exists in the menu bar").toBe(true);
  return state.found ? state.enabled : false;
}

/**
 * Poll for the picker rather than waiting out an animation: a background
 * app-test window runs no rAF and throttles DOM timers, so a fixed wait tied
 * to the menu's open transition would be a test that passes by not running.
 */
async function waitForMenu(app: App, present: boolean): Promise<void> {
  await app.waitForCondition<boolean>(
    `(document.querySelectorAll(${JSON.stringify(MENU)}).length > 0) === ${present ? "true" : "false"}`,
    { timeoutMs: 5_000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0348 — Window ▸ Reveal Stack: gated on depth, and the chord toggles",
  () => {
    test(
      "the item validates against the focused pane's stack depth",
      async () => {
        const app = await launchTugApp({ testName: "at0348-reveal-stack-gate" });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('.tug-pane[data-pane-id]').length === 5`,
            { timeoutMs: 5_000 },
          );
          await wait(AFTER_LAND_MS);

          await focusCard(app, "A");
          expect(await revealEnabled(app), "a pane sharing its slot has somewhere to go").toBe(true);

          await focusCard(app, "B");
          expect(await revealEnabled(app), "a pane alone in its slot has not").toBe(false);

          await focusCard(app, "F");
          expect(await revealEnabled(app), "a free pane holds no slot, so no stack").toBe(false);

          await focusCard(app, "L");
          expect(await revealEnabled(app), "the Lens never carries a slot").toBe(false);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "⌘R opens the focused pane's picker and a second ⌘R closes it",
      async () => {
        const app = await launchTugApp({ testName: "at0348-reveal-stack-chord" });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('.tug-pane[data-pane-id]').length === 5`,
            { timeoutMs: 5_000 },
          );
          await wait(AFTER_LAND_MS);
          await focusCard(app, "A");

          // Put ⌘R on Reveal Stack. The host moves the key equivalent off
          // Cycle Stack when the preference arrives on the menu-state push, so
          // give that round-trip room before pressing.
          await app.evalJS<null>(`(window.__tug.setStackChord("reveal"), null)`);
          await wait(300);

          await waitForMenu(app, false);

          await app.nativeKey("r", ["cmd"]);
          await waitForMenu(app, true);

          // The toggle. This second press dispatches through the chain again;
          // the responder action flips the bit to false and the open menu's
          // own observeDispatch subscription — notified after the action —
          // sets the same false. One outcome, not a race.
          await app.nativeKey("r", ["cmd"]);
          await waitForMenu(app, false);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
