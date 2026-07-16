/**
 * at0196-z4b-chip-buttons.test.ts — the Z4B "Claude Code" and "Session"
 * chips are interactive buttons with their assigned click behaviors
 * ([AT0196]).
 *
 * ## Why this exists
 *
 * The Z4B indicator cluster used to render its two left chips as display
 * `TugBadge`s. They are now `TugPushButton`s, joining the Project / Mode /
 * Model / Effort controls beside them ([D13]):
 *
 *   - **Claude Code** (`session-route-indicator-badge`): a left click opens
 *     Anthropic's Claude Code changelog in the system browser
 *     (`openUrlInOS` → `window.open`); a right click opens the version /
 *     drift report popover (`session-route-indicator-badge-report`).
 *   - **Session** (`session-id-badge`): a click opens the session's
 *     on-disk JSONL directory in Finder (`openPathInOS` →
 *     `webkit.messageHandlers.openPath`, a `~/.claude/projects/…` folder).
 *
 * The changelog click is driven for real with `window.open` stubbed to
 * capture the URL (no browser tab spawned). The Session chip is verified
 * by its derived `title` — the real `~/.claude/projects/<encode(cwd)>`
 * folder computed from the live binding — rather than by clicking, since
 * the native `openPath` host bridge can't be stubbed from JS and a real
 * click would spawn a Finder window mid-test. Both chips are asserted to
 * be real, enabled `<button>` elements.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CLAUDE_CHIP =
  '[data-card-id="A"] [data-slot="session-route-indicator-badge"]';
const SESSION_CHIP =
  '[data-card-id="A"] [data-slot="session-id-badge"]';
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

/** Read an attribute off the matched element, or null. */
async function attrOf(
  app: App,
  selector: string,
  attr: string,
): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      return el ? el.getAttribute(${JSON.stringify(attr)}) : null;
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
  "AT0196: Z4B Claude Code + Session chips are interactive buttons",
  () => {
    test(
      "both chips are buttons; clicks drive changelog / Finder; right-click opens the report",
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

          // Both chips render and have mounted as real <button> elements.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CLAUDE_CHIP)}) !== null
              && document.querySelector(${JSON.stringify(SESSION_CHIP)}) !== null`,
            { timeoutMs: 4000 },
          );
          expect(await tagOf(app, CLAUDE_CHIP)).toBe("BUTTON");
          expect(await tagOf(app, SESSION_CHIP)).toBe("BUTTON");

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

          // The Session chip is enabled and its title carries the
          // `~/.claude/projects/<encode(cwd)>` folder it opens — derived
          // from the live binding's project dir (`/tmp/test-project` in
          // the synthetic harness binding → `-tmp-test-project`).
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(SESSION_CHIP)}).disabled === true`,
            ),
          ).toBe(false);
          const sessionTitle = await attrOf(app, SESSION_CHIP, "title");
          expect(sessionTitle).not.toBeNull();
          expect(sessionTitle!).toContain("~/.claude/projects/-tmp-test-project");

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
