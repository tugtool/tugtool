/**
 * at0196-z4b-chip-buttons.test.ts — the Z4B "Claude Code" chip is an
 * interactive button with its assigned click behaviors ([AT0196]).
 *
 * ## Why this exists
 *
 * The Z4B indicator cluster used to render its left chips as display
 * `TugBadge`s. They are `TugPushButton`s now, joining the Mode / Model /
 * Effort controls beside them ([D13]):
 *
 *   - **Claude Code** (`session-route-indicator-badge`): a left click opens
 *     Anthropic's Claude Code changelog in the system browser
 *     (`openUrlInOS` → `window.open`); a right click opens the version /
 *     drift report popover (`session-route-indicator-badge-report`).
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
 * @covers tugdeck/src/components/tugways/chrome/session-route-indicator-badge.css
 * @covers tugdeck/src/components/tugways/chrome/session-route-indicator-badge.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CLAUDE_CHIP =
  '[data-card-id="A"] [data-slot="session-route-indicator-badge"]';
/** Retired by the Z4B diet — asserted absent, never expected to mount. */
const SESSION_CHIP =
  '[data-card-id="A"] [data-slot="session-id-badge"]';
/** Also off the code route by the same diet; still on shell / commit (at0215). */
const PROJECT_CHIP = '[data-card-id="A"] [data-slot="project-chip"]';
const REPORT_SELECTOR = '[data-slot="session-route-indicator-badge-report"]';

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
      "the chip is a button, its click opens the changelog, its right-click the report — and the dieted chips are absent",
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

          // The Claude Code chip renders as a real <button>…
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CLAUDE_CHIP)}) !== null`,
            { timeoutMs: 4000 },
          );
          expect(await tagOf(app, CLAUDE_CHIP)).toBe("BUTTON");

          // …and the two chips the Z4B diet removed do not render at all on
          // this route. Both names are in the pane title bar instead.
          expect(await tagOf(app, SESSION_CHIP)).toBeNull();
          expect(await tagOf(app, PROJECT_CHIP)).toBeNull();

          await stubWindowOpen(app);

          // Left click on Claude Code → opens the changelog URL.
          await app.nativeClickAtElement(CLAUDE_CHIP);
          await app.waitForCondition<boolean>(
            `window.__z4b.openUrls.length > 0`,
            { timeoutMs: 4000 },
          );
          const openedUrl = await app.evalJS<string>(
            `window.__z4b.openUrls[0]`,
          );
          expect(openedUrl).toBe(CHANGELOG_URL);

          // Right click on Claude Code → opens the version/drift report.
          await app.nativeRightClickAtElement(CLAUDE_CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(REPORT_SELECTOR)}) !== null`,
            { timeoutMs: 4000 },
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(REPORT_SELECTOR)}) !== null`,
            ),
          ).toBe(true);
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
