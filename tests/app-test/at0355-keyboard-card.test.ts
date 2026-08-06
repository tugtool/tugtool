/**
 * at0355-keyboard-card.test.ts — the Keyboard Shortcuts card, and that there
 * is only ever one of it ([AT0355]).
 *
 * The keymap configurator used to be a tab inside Settings. It is a card now,
 * because its list needs a container with a definite height and only a pane
 * gives it one. Two claims follow from that move and are what this file pins:
 * the card opens from each of its doors with the configurator actually
 * rendered inside it, and a second invocation raises the card that exists
 * rather than making another. A user with five keymap editors open would have
 * five answers to "what is ⌘W bound to".
 *
 * The door driven here is the app menu's item, via the command it sends. The
 * other — the Lens — is a listing, and `cards-groups.test.ts` already enforces
 * that every registration resolves a Lens home.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/cards/keyboard-card.tsx
 * @covers tugdeck/src/components/tugways/cards/settings-keymap-body.tsx
 * @covers tugdeck/src/action-dispatch.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const NO_AX = { skipAccessibilityPreflight: true } as const;

/** Expression: count of deck cards with the given componentId. */
function countByComponent(componentId: string): string {
  return `window.tugdeck.diag.getDeckState().cards.filter(
    (c) => c.componentId === ${JSON.stringify(componentId)},
  ).length`;
}

const KEYBOARD_CARD = '[data-testid="keyboard-card"]';
const KEYMAP = '[data-testid="settings-keymap"]';

describe.skipIf(!SHOULD_RUN)("at0355: the Keyboard Shortcuts card", () => {
  test("opens from the menu command with the configurator inside, and stays one card", async () => {
    const app = await launchTugApp({ ...NO_AX, testName: "at0355-keyboard-card" });
    try {
      // ---- The app menu's Keyboard Shortcuts… item sends this command.
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-keyboard-shortcuts", {})`,
      );
      await app.waitForCondition<boolean>(`${countByComponent("keyboard")} === 1`);
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(KEYBOARD_CARD)}) !== null`,
      );

      // The configurator renders inside it, with rows — an empty list would
      // mean the height chain the card exists to supply did not resolve.
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(`${KEYBOARD_CARD} ${KEYMAP}`)}) !== null`,
        { timeoutMs: 8000 },
      );
      expect(
        await app.evalJS<number>(
          `document.querySelectorAll(
            ${JSON.stringify(`${KEYBOARD_CARD} .tug-list-row`)},
          ).length`,
        ),
      ).toBeGreaterThan(0);

      // ---- Put another pane on top so a raise is distinguishable from a
      //      no-op, then invoke again.
      const keyboardCardId = await app.evalJS<string>(
        `window.tugdeck.diag.getDeckState().cards.find(
          (c) => c.componentId === "keyboard",
        ).id`,
      );
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-card", { component: "hello" })`,
      );
      await app.waitForCondition<boolean>(`${countByComponent("hello")} === 1`);
      expect(await app.getFocusedCardId()).not.toBe(keyboardCardId);

      await app.evalJS(
        `window.__tug.dispatchControlAction("show-keyboard-shortcuts", {})`,
      );
      await app.waitForCondition<boolean>(
        `window.tugdeck.diag.getDeckState().panes.at(-1).cardIds.includes(
          ${JSON.stringify(keyboardCardId)},
        )`,
      );
      expect(await app.evalJS<number>(countByComponent("keyboard"))).toBe(1);
      expect(await app.getFocusedCardId()).toBe(keyboardCardId);
    } finally {
      await app.close();
    }
  });
});
