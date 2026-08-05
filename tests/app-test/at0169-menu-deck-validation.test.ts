/**
 * at0169-menu-deck-validation.test.ts — deck-state-tier menu validation.
 *
 * The deck-state tier of `AppDelegate.validateMenuItem` is driven by
 * the `menuState` push's pane projection:
 *
 *   - `window.previousCard` / `window.nextCard` (⇧⌘[ / ⇧⌘]) — enabled
 *     when the focused pane holds more than one card.
 *   - `window.cyclePanes` (⌃`) — enabled when the deck has ≥2 panes.
 *
 * (`maker.newCardInPane`, ⌘T, also rides this tier, but lives in the
 * debug-gated Maker menu and is absent from the apptest bundle, so it
 * isn't probed here.)
 *
 * Also covers the card-type tier's negative half with a non-dev
 * active card: every session-card command surface (`session.*`,
 * `edit.copyLastResponse`, `file.exportTranscript`, `help.shortcuts`)
 * validates disabled.
 *
 * Verified through `menuItemState` — the real validated state, not a
 * stored flag. Assertions by identifier only.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugapp/Sources/AppDelegate.swift
 * @covers tugdeck/src/lib/host-menu-state.ts
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
    acceptsFamilies: ["maker"],
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

/** Two panes sharing one slot — a stack the focused pane can switch within
 *  (`stackDepth` 2). Both panes carry `slot: 0`; the projection's depth is
 *  the length of the focused pane's slot stack. */
function stackedPanes() {
  return {
    cards: [card("C0"), card("C1")],
    panes: [
      { ...pane("p1", ["C0"], 0), slot: 0 },
      { ...pane("p2", ["C1"], 1), slot: 0 },
    ],
    activePaneId: "p2",
    hasFocus: true,
  };
}

/** Poll a menu item's key equivalent until it matches, then return it. */
async function waitMenuKeyEquivalent(
  app: App,
  identifier: string,
  want: string,
  timeoutMs = 8000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  let last: string | undefined;
  while (Date.now() < deadline) {
    const state = await app.menuItemState(identifier);
    last = state.found ? state.keyEquivalent : undefined;
    if (last === want) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
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
    "single pane, single card: card-nav and cycle disabled",
    async () => {
      const app = await launchTugApp({ testName: "at0169-single" });
      try {
        await app.seedDeckState({ state: singlePaneSingleCard(), focusCardId: "C0" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("C0")`,
        );

        await expectEnabled(app, "window.previousCard", false);
        await expectEnabled(app, "window.nextCard", false);
        await expectEnabled(app, "window.cyclePanes", false);

        // The slot stack has nowhere to go, so both stack items validate
        // disabled — and neither may keep ⌘R. A chord on a disabled item is
        // eaten at the menu bar with a beep instead of falling through to the
        // web view, so leaving it attached would make ⌘R dead rather than
        // merely inapplicable.
        await expectEnabled(app, "window.cycleStack", false);
        await expectEnabled(app, "window.revealStack", false);
        expect(
          await waitMenuKeyEquivalent(app, "window.cycleStack", ""),
          "Cycle Stack drops ⌘R at depth ≤ 1",
        ).toBe("");
        expect(
          await waitMenuKeyEquivalent(app, "window.revealStack", ""),
          "Reveal Stack drops ⌘R at depth ≤ 1",
        ).toBe("");
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
    "two panes: pane cycling enabled; non-session card gates the dev-command surfaces off",
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
        // gallery-input, so every session-card command surface is disabled.
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

  test(
    "stacked panes: the stack items light up and one of them takes ⌘R",
    async () => {
      const app = await launchTugApp({ testName: "at0169-stack" });
      try {
        await app.seedDeckState({ state: stackedPanes(), focusCardId: "C1" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("C1")`,
        );

        await expectEnabled(app, "window.cycleStack", true);
        await expectEnabled(app, "window.revealStack", true);

        // Exactly one of the two carries the chord — which one is the user's
        // `stackChord` preference, defaulting to Cycle Stack. Both holding it
        // would make ⌘R ambiguous; neither holding it is the depth ≤ 1 state.
        const cycle = await waitMenuKeyEquivalent(app, "window.cycleStack", "r");
        expect(cycle, "Cycle Stack owns ⌘R by default once the stack is deep").toBe("r");
        const reveal = await app.menuItemState("window.revealStack");
        expect(
          reveal.found ? reveal.keyEquivalent : undefined,
          "Reveal Stack stays mouse-only while Cycle Stack owns the chord",
        ).toBe("");
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0169-stack] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
