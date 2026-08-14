/**
 * at0406-masthead-dash-chip.test.ts — the bound dash's name in the Session
 * card's masthead, bound and unbound by the real CLI through the card's own
 * shell route.
 *
 * The whole loop is real. `tugutil dash bind` resolves the calling session
 * from `TUG_SESSION_ID` — which is exactly what the `$` shell route stamps on
 * the child — and POSTs `/api/dash` to the instance whose ledger owns that
 * session, so the session is seeded into this instance's ledger first
 * (`seedLedger`) or the command exits with `no session`. The chip that
 * appears is driven by the `bind_dash_ok` broadcast coming back, with no
 * reload and no card involvement; `dash unbind` takes it away the same way.
 *
 * Two things are pinned besides the name. The chip rides the title line's
 * trailing slot — inside the row's content box, i.e. inside the width the
 * masthead already reserves against the pane's control cluster — so it cannot
 * collide with pane chrome by construction. And the 72px chrome tier does not
 * change height when the chip arrives: a card that reflows when a dash is
 * bound would move the transcript under the reader's eyes.
 *
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/lib/card-session-binding-store.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { launchTugApp, note, type App } from "./_harness";
import { createDash, releaseDash, tugutilPath } from "./dash-fixture";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const SID = "at0406-session";
const CARD = '[data-card-id="A"]';
const PROMPT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
// The masthead renders in the pane title bar, ABOVE the card host — not
// inside the card element.
const MASTHEAD = '[data-slot="session-masthead"]';
const CHIP = `${MASTHEAD} [data-slot="session-masthead-dash-chip"]`;
const SHELL_ROWS = `${CARD} [data-slot="session-transcript-shell-row"]`;

const PROJECT_DIR = realpathSync(resolve(import.meta.dir, "..", ".."));
const DASH_NAME = "at0406-chip";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  createDash(PROJECT_DIR, DASH_NAME, "at0406 fixture");
});

afterAll(() => {
  if (!SHOULD_RUN) return;
  releaseDash(PROJECT_DIR, DASH_NAME);
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 680 },
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

/** Run `command` through the card's `$` shell route and wait for its row to
 *  settle with an exit label — the route is what stamps `TUG_SESSION_ID`. */
async function shellAndSettle(
  app: App,
  command: string,
  expectedIndex: number,
): Promise<void> {
  await app.nativeClickAtElement(PROMPT);
  await app.nativeType(`/shell ${command}`);
  await new Promise((r) => setTimeout(r, 150));
  await app.nativeKey("Enter", ["cmd"]);
  await app.waitForCondition<boolean>(
    `(function(){
       var rows = document.querySelectorAll(${JSON.stringify(SHELL_ROWS)});
       if (rows.length !== ${expectedIndex + 1}) return false;
       var foot = rows[${expectedIndex}].querySelector('[data-slot="session-z1b-end-state"]');
       return foot !== null && foot.textContent.indexOf("exit") !== -1;
     })()`,
    { timeoutMs: 30_000 },
  );
}

const mastheadHeight = (app: App): Promise<number> =>
  app.evalJS<number>(
    `Math.round(document.querySelector(${JSON.stringify(MASTHEAD)}).getBoundingClientRect().height)`,
  );

describe.skipIf(!SHOULD_RUN)("AT0406: the masthead's dash chip", () => {
  test(
    "a real dash bind paints the chip on the title line and unbind takes it away",
    async () => {
      const app = await launchTugApp({ testName: "at0406-masthead-dash-chip" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", {
          tugSessionId: SID,
          projectDir: PROJECT_DIR,
          workspaceKey: PROJECT_DIR,
        });
        await app.awaitEngineReady("A", { timeoutMs: 15000 });
        // The bind verb resolves the instance whose ledger OWNS this session;
        // a client-side binding alone is invisible to it. After launch, not
        // before: tugcast demotes every `live` row to `closed` at startup.
        app.seedLedger({
          sessions: [
            {
              session_id: SID,
              workspace_key: PROJECT_DIR,
              project_dir: PROJECT_DIR,
              card_id: "A",
              name: "at0406 work",
            },
          ],
        });

        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 10000 },
        );
        expect(await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(CHIP)}).length`,
        )).toBe(0);
        const bareHeight = await mastheadHeight(app);

        // ── Bind, for real ────────────────────────────────────────────────
        await shellAndSettle(app, `${tugutilPath(PROJECT_DIR)} dash bind ${DASH_NAME}`, 0);
        note(
          "at0406 bind row",
          await app.evalJS<string>(
            `(document.querySelectorAll(${JSON.stringify(SHELL_ROWS)})[0]?.textContent ?? "").trim().slice(0, 400)`,
          ),
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHIP)}) !== null`,
          { timeoutMs: 15000 },
        );

        const chip = await app.evalJS<{
          text: string;
          inSlot: boolean;
          title: string | null;
          overflowsRow: boolean;
        }>(
          `(() => {
             const chip = document.querySelector(${JSON.stringify(CHIP)});
             const slot = chip.closest(".tug-session-row-slots");
             const line = chip.closest(".tug-session-row-name-line");
             const c = chip.getBoundingClientRect();
             const l = line.getBoundingClientRect();
             return {
               text: (chip.textContent ?? "").trim(),
               inSlot: slot !== null,
               title: chip.getAttribute("title"),
               overflowsRow: c.right > l.right + 1,
             };
           })()`,
        );
        expect(chip.text).toBe(DASH_NAME);
        // Inside the title line's trailing slot — the geometry that makes a
        // collision with the pane's control cluster impossible.
        expect(chip.inSlot).toBe(true);
        expect(chip.overflowsRow).toBe(false);
        expect(chip.title).toBe(`Working on dash ${DASH_NAME}`);
        // The chrome tier does not grow to make room for the chip.
        expect(await mastheadHeight(app)).toBe(bareHeight);

        const shot = await app.screenshot();
        note("at0406 masthead with the dash chip", shot.path);

        // ── Unbind, for real ──────────────────────────────────────────────
        await shellAndSettle(app, `${tugutilPath(PROJECT_DIR)} dash unbind`, 1);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHIP)}) === null`,
          { timeoutMs: 15000 },
        );
        expect(await mastheadHeight(app)).toBe(bareHeight);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
