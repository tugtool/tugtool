/**
 * at0305-picker-seeds-default-dir.test.ts — the session picker's path seed
 * falls to the user's default project directory ([AT0305]).
 *
 * Scenario:
 *
 *   Seed an empty recent-projects list and a known default project directory
 *   into the tugbank cache BEFORE the Session card mounts — the picker's path
 *   seed is one-shot, so a value arriving after the first seed lands would be
 *   ignored by design. Then mount the card and verify the path field shows the
 *   default directory rather than the Swift `initial-project-path` launch hint
 *   or the home directory.
 *
 *   The seed chain under test is recents[0] → explicit default → Swift hint →
 *   home; this test pins the second tier by emptying the first.
 *
 * Gating
 * ------
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs without
 * `TUGAPP_APP_TEST=1` skip every test.
 *
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 * @covers tugdeck/src/settings-api.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const PATH_INPUT = '[data-tug-focus-key="session-picker-cycle:0"]';
const PICKER_FORM = ".session-card-picker-form";

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "session", title: "Session", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 600 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)(
  "at0305: the picker seeds its path from the default project directory",
  () => {
    test("with no recents, the path field opens on the default directory", async () => {
      const dir = mkdtempSync(`${tmpdir()}/at0305-projects-`);
      const app = await launchTugApp({
        testName: "at0305-picker-seeds-default-dir",
      });
      try {
        // Seed before the card mounts — the path seed is one-shot.
        await app.waitForCondition<boolean>(
          `typeof window.__tug !== "undefined"`,
        );
        await app.evalJS<null>(
          `(window.__tug.setTugbankValue("dev.tugtool.dev", "recent-projects", { kind: "json", value: { paths: [] } }),
            window.__tug.setTugbankValue("dev.tugtool.app", "default-project-path", { kind: "string", value: ${JSON.stringify(dir)} }),
            null)`,
        );

        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(PATH_INPUT)}); return el !== null && el.value.length > 0; })()`,
          { timeoutMs: 8000 },
        );

        expect(await app.getElementValue(PATH_INPUT)).toBe(dir);
      } finally {
        await app.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);
