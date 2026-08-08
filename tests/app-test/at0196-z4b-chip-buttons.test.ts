/**
 * at0196-z4b-chip-buttons.test.ts — the Z4B "AI" chip is an interactive
 * button with its assigned click behaviors ([AT0196]).
 *
 * ## Why this exists
 *
 * The Z4B indicator cluster used to render its left chips as display
 * `TugBadge`s, then as four `TugPushButton`s ([D13]). They are one chip now:
 *
 *   - **AI** (`ai-chip`): a left click opens the configuration mixer; a right
 *     click opens the version / drift report popover (`ai-chip-report`).
 *
 * The gesture split is the merge's doing. The Claude Code chip's left click
 * used to open Anthropic's changelog, but a chip that configures the AI has to
 * spend its left click on the sheet — so the changelog moves to a footer link
 * INSIDE that sheet, and this test follows it there. The report keeps
 * right-click: it is the only door to the drift detail.
 *
 * The changelog click is driven for real with `window.open` stubbed to
 * capture the URL (no browser tab spawned).
 *
 * The **Session** chip this file also used to cover is gone: the Z4B diet
 * unmounted it (and the Project chip) from the code route, because both names
 * already read in the pane title bar and they were the cluster's two most
 * expensive variable faces. Its absence is asserted here rather than merely
 * un-tested — a chip that comes back silently is exactly what would undo the
 * diet — while the Project chip's continued presence on the shell and commit
 * routes stays at0215's business.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 * @covers tugdeck/src/components/tugways/tug-push-button.tsx
 * @covers tugdeck/src/lib/session-metadata-store.ts
 * @covers tugdeck/src/components/tugways/cards/ai-chip.css
 * @covers tugdeck/src/components/tugways/cards/ai-chip.tsx
 * @covers tugdeck/src/components/tugways/cards/ai-config-sheet.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const AI_CHIP = '[data-card-id="A"] [data-slot="ai-chip"]';
/** Retired by the Z4B diet — asserted absent, never expected to mount. */
const SESSION_CHIP =
  '[data-card-id="A"] [data-slot="session-id-badge"]';
/** Also off the code route by the same diet; still on shell / commit (at0215). */
const PROJECT_CHIP = '[data-card-id="A"] [data-slot="project-chip"]';
const REPORT_SELECTOR = '[data-slot="ai-chip-report"]';
const SHEET_SELECTOR = '[data-slot="ai-config-sheet"]';
const CHANGELOG_LINK = '[data-slot="ai-config-changelog-link"]';

const CHANGELOG_URL =
  "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md";

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 540 },
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

/** Read an element's tagName (uppercase), or null when the node is absent. */
async function tagOf(app: App, selector: string): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      return el ? el.tagName : null;
    })()`,
  );
}

/**
 * Replace `window.open` with a capturing stub so the real changelog
 * onClick path runs to its boundary without spawning a browser tab.
 */
async function stubWindowOpen(app: App): Promise<void> {
  await app.evalJS<void>(
    `(function(){
      var w = window;
      w.__z4b = { openUrls: [] };
      w.open = function(url){ w.__z4b.openUrls.push(url); return null; };
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0196: the Z4B Claude Code chip is an interactive button",
  () => {
    test(
      "the chip is a button, its click opens the mixer (whose footer opens the changelog), its right-click the report — and the dieted chips are absent",
      async () => {
        const app = await launchTugApp({ testName: "at0196-z4b-chip-buttons" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindSession("A");
          await app.awaitEngineReady("A");

          // The AI chip renders as a real <button>…
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(AI_CHIP)}) !== null`,
            { timeoutMs: 4000 },
          );
          expect(await tagOf(app, AI_CHIP)).toBe("BUTTON");

          // …and the two chips the Z4B diet removed do not render at all on
          // this route. Both names are in the pane title bar instead.
          expect(await tagOf(app, SESSION_CHIP)).toBeNull();
          expect(await tagOf(app, PROJECT_CHIP)).toBeNull();

          await stubWindowOpen(app);

          // Right click on the AI chip → opens the version/drift report. Done
          // first, because the left click below leaves a sheet standing.
          await app.nativeRightClickAtElement(AI_CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(REPORT_SELECTOR)}) !== null`,
            { timeoutMs: 4000 },
          );
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(REPORT_SELECTOR)}) === null`,
            { timeoutMs: 4000 },
          );

          // Left click on the AI chip → opens the configuration mixer, NOT the
          // changelog. Nothing has been opened in the browser yet.
          await app.nativeClickAtElement(AI_CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SHEET_SELECTOR)}) !== null`,
            { timeoutMs: 4000 },
          );
          expect(
            await app.evalJS<number>(`window.__z4b.openUrls.length`),
            "the chip click opens the sheet, not a browser tab",
          ).toBe(0);

          // The changelog kept its door — it is the sheet's footer link now.
          await app.nativeClickAtElement(CHANGELOG_LINK);
          await app.waitForCondition<boolean>(
            `window.__z4b.openUrls.length > 0`,
            { timeoutMs: 4000 },
          );
          expect(await app.evalJS<string>(`window.__z4b.openUrls[0]`)).toBe(
            CHANGELOG_URL,
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0196-z4b-chip-buttons] log tail:\n${tail}\n`,
            );
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
