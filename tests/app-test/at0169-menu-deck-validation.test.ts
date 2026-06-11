/**
 * at0169-menu-deck-validation.test.ts — deck-state-tier menu validation.
 *
 * The deck-state tier of `AppDelegate.validateMenuItem` is driven by
 * the `menuState` push's pane projection:
 *
 *   - `file.newCardInPane` (⌘T) — enabled when the deck has ≥1 pane.
 *   - `window.previousCard` / `window.nextCard` (⇧⌘[ / ⇧⌘]) — enabled
 *     when the focused pane holds more than one card.
 *   - `window.cyclePanes` (⌃`) — enabled when the deck has ≥2 panes.
 *
 * Also covers the card-type tier's negative half with a non-dev
 * active card: every dev-card command surface (`session.*`,
 * `edit.copyLastResponse`, `file.exportTranscript`, `help.shortcuts`)
 * validates disabled.
 *
 * Verified through `menuItemState` — the real validated state, not a
 * stored flag. Assertions by identifier only.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

function card(id: string) {
  return { id, componentId: "gallery-input", title: `Card ${id}`, closable: true };
}

/** One pane holding the given cards. Position staggers per index so
 *  multi-pane seeds don't overlap. */
function pane(id: string, cardIds: string[], index = 0) {
  return {
    id,
    position: { x: 60 + index * 80, y: 60 + index * 60 },
    size: { width: 640, height: 480 },
    cardIds,
    activeCardId: cardIds[0],
    title: "",
    acceptsFamilies: ["developer"],
  };
}

/** Deck with one single-card pane. */
function singlePaneSingleCard() {
  return {
    cards: [card("C0")],
    panes: [pane("p1", ["C0"])],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** Deck with one pane holding two cards. */
function singlePaneMultiCard() {
  return {
    cards: [card("C0"), card("C1")],
    panes: [pane("p1", ["C0", "C1"])],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** Deck with two single-card panes (p2 is last in z-order → focused). */
function twoPanes() {
  return {
    cards: [card("C0"), card("C1")],
    panes: [pane("p1", ["C0"], 0), pane("p2", ["C1"], 1)],
    activePaneId: "p2",
    hasFocus: true,
  };
}

/** Poll the validated menu-item state until it matches `wantEnabled`. */
async function waitMenuEnabled(
  app: App,
  identifier: string,
  wantEnabled: boolean,
  timeoutMs = 8000,
): Promise<{ found: boolean; enabled?: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let last: { found: boolean; enabled?: boolean } = { found: false };
  while (Date.now() < deadline) {
    last = await app.menuItemState(identifier);
    if (last.found && last.enabled === wantEnabled) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

async function expectEnabled(app: App, identifier: string, want: boolean): Promise<void> {
  const state = await waitMenuEnabled(app, identifier, want);
  expect(state.found, `${identifier} must exist`).toBe(true);
  expect(state.enabled, `${identifier} enabled=${want}`).toBe(want);
}

describe.skipIf(!SHOULD_RUN)("AT0169: deck-tier menu validation", () => {
  test(
    "single pane, single card: new-in-pane enabled; card-nav and cycle disabled",
    async () => {
      const app = await launchTugApp({ testName: "at0169-single" });
      try {
        await app.seedDeckState({ state: singlePaneSingleCard(), focusCardId: "C0" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("C0")`,
        );

        await expectEnabled(app, "file.newCardInPane", true);
        await expectEnabled(app, "window.previousCard", false);
        await expectEnabled(app, "window.nextCard", false);
        await expectEnabled(app, "window.cyclePanes", false);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0169-single] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "multi-card pane: card navigation enabled, pane cycling still disabled",
    async () => {
      const app = await launchTugApp({ testName: "at0169-multicard" });
      try {
        await app.seedDeckState({ state: singlePaneMultiCard(), focusCardId: "C0" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("C0") && window.__tug.assertHostRootRegistered("C1")`,
        );

        await expectEnabled(app, "window.previousCard", true);
        await expectEnabled(app, "window.nextCard", true);
        await expectEnabled(app, "window.cyclePanes", false);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0169-multicard] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "two panes: pane cycling enabled; non-dev card gates the dev-command surfaces off",
    async () => {
      const app = await launchTugApp({ testName: "at0169-twopanes" });
      try {
        await app.seedDeckState({ state: twoPanes(), focusCardId: "C1" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("C0") && window.__tug.assertHostRootRegistered("C1")`,
        );

        await expectEnabled(app, "window.cyclePanes", true);
        // Single-card focused pane → card navigation stays disabled.
        await expectEnabled(app, "window.nextCard", false);

        // Card-type tier, negative half: the active card is a
        // gallery-input, so every dev-card command surface is disabled.
        await expectEnabled(app, "session.focusPrompt", false);
        await expectEnabled(app, "session.stop", false);
        await expectEnabled(app, "session.model", false);
        await expectEnabled(app, "session.permissionMode.default", false);
        await expectEnabled(app, "edit.copyLastResponse", false);
        await expectEnabled(app, "file.exportTranscript", false);
        await expectEnabled(app, "help.shortcuts", false);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0169-twopanes] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
