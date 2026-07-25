/**
 * at0265-commit-sha-right-click.test.ts — right-clicking a commit sha opens its
 * copy menu and must NOT fold the row under it.
 *
 * The sha is a copy target inside a row whose whole width toggles the commit's
 * detail. A native right-click (and the Copy activation that follows it) must
 * reach only the menu; the row's expansion state is unchanged throughout.
 *
 * @covers tugdeck/src/components/tugways/commit-sha-text.tsx
 * @covers tugdeck/src/components/tugways/tug-history-list.tsx
 * @covers tugdeck/src/components/tugways/cards/gallery-commit-surfaces.tsx
 * @covers tugdeck/src/components/tugways/cards/session-history/session-history-view.tsx
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

/** The worktree root — the real repo tugcast serves as its bootstrap tree. */
const REPO = resolve(import.meta.dir, "..", "..");
const HISTORY_ROW = `[data-slot="session-history-view"] [data-testid="session-history-commit"]`;

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const CARD_ID = "A";
const ROW = '[data-card-id="A"] [data-testid="session-history-commit"]';
const SHA = `${ROW} code.commit-sha-text`;

function deckSeed(componentId: string) {
  return {
    state: {
      cards: [{ id: CARD_ID, componentId, title: componentId, closable: true }],
      panes: [
        {
          id: "p1",
          position: { x: 40, y: 40 },
          size: { width: 720, height: 720 },
          cardIds: [CARD_ID],
          activeCardId: CARD_ID,
          title: "",
          acceptsFamilies: ["maker"],
        },
      ],
      activePaneId: "p1",
      hasFocus: true,
    },
    focusCardId: CARD_ID,
  };
}

describe.skipIf(!SHOULD_RUN)("AT0265 commit sha right-click", () => {
  test("right-click + Copy never expands the row", async () => {
    const app = await launchTugApp({ testName: "at0265-commit-sha-right-click" });
    try {
      await app.seedDeckState(deckSeed("gallery-commit-surfaces"));
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(SHA)}) !== null`,
        { timeoutMs: 8000 },
      );

      const expanded = async (): Promise<boolean> =>
        app.evalJS<boolean>(
          `document.querySelector(${JSON.stringify(ROW)}).getAttribute("data-expanded") === "true"`,
        );

      expect(await expanded()).toBe(false);

      // The gesture under test: a real right-button click on the sha.
      await app.nativeRightClickAtElement(SHA);
      await app.waitForCondition<boolean>(
        `document.querySelector(".tug-editor-context-menu") !== null`,
        { timeoutMs: 4000 },
      );
      expect(await expanded()).toBe(false);

      // …and the Copy activation that follows it. The menu closes on the
      // item's mousedown, so whatever the follow-up click lands on must not
      // toggle the row either.
      await app.nativeClickAtElement(".tug-editor-context-menu .tug-menu-item");
      await app.waitForCondition<boolean>(
        `document.querySelector(".tug-editor-context-menu") === null`,
        { timeoutMs: 4000 },
      );
      expect(await expanded()).toBe(false);

      // The row still folds on its own gesture — a left-click on the subject.
      await app.nativeClickAtElement(`${ROW} .tugx-commit-identity`);
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(ROW)}).getAttribute("data-expanded") === "true"`,
        { timeoutMs: 4000 },
      );
      expect(await expanded()).toBe(true);
    } finally {
      await app.close();
    }
  }, 120_000);

  // The same gesture on the real surface the report came from: the History
  // shade over a session card bound to this worktree.
  test("the History shade's rows behave the same", async () => {
    const tugbankPath = mkTempTugbank();
    try {
      seedTugbankForLaunch(tugbankPath, { sourceTreePath: REPO });
      const app = await launchTugApp({
        testName: "at0265-history-shade-right-click",
        env: { TUGBANK_PATH: tugbankPath },
        persistInTestMode: true,
      });
      try {
        await app.waitForCondition<boolean>(`typeof window.__tug !== "undefined"`, {
          timeoutMs: 5_000,
        });
        await app.seedDeckState({
          state: {
            cards: [{ id: "D", componentId: "session", title: "Session", closable: true }],
            panes: [
              {
                id: "pD",
                position: { x: 40, y: 40 },
                size: { width: 720, height: 560 },
                cardIds: ["D"],
                activeCardId: "D",
                title: "",
                acceptsFamilies: ["maker"],
              },
            ],
            activePaneId: "pD",
            hasFocus: true,
          },
          focusCardId: "D",
        });
        await app.waitForCondition<boolean>(
          `window.__tug.assertHostRootRegistered("D")`,
          { timeoutMs: 5_000 },
        );
        await app.bindSession("D", { projectDir: REPO });
        await app.dispatchControlAction("toggle-history-view");
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(HISTORY_ROW)}).length > 0`,
          { timeoutMs: 6_000 },
        );

        const expanded = async (): Promise<boolean> =>
          app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(HISTORY_ROW)}).getAttribute("data-expanded") === "true"`,
          );

        expect(await expanded()).toBe(false);
        await app.nativeRightClickAtElement(`${HISTORY_ROW} code.commit-sha-text`);
        await app.waitForCondition<boolean>(
          `document.querySelector(".tug-editor-context-menu") !== null`,
          { timeoutMs: 4000 },
        );
        expect(await expanded()).toBe(false);

        await app.nativeClickAtElement(".tug-editor-context-menu .tug-menu-item");
        await app.waitForCondition<boolean>(
          `document.querySelector(".tug-editor-context-menu") === null`,
          { timeoutMs: 4000 },
        );
        expect(await expanded()).toBe(false);
      } finally {
        await app.close();
      }
    } finally {
      rmTempTugbank(tugbankPath);
    }
  }, 120_000);
});
