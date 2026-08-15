/**
 * at0424-lens-dash-subrow.test.ts — the dash nests under the session working
 * it in the Lens's Cards section.
 *
 * The Cards section is organized by CARDS, so a dash's place in it is under
 * the session that is on it: the reader is looking at the session, and the
 * dash is what that session is doing. What the sub-row adds over the title's
 * own dash run is the reason the run above it is suppressed — the stage, the
 * step counters, the review mark — so both halves are pinned here: the sub-row
 * appears with its facts, and the session row above it carries NO dash run
 * while it does.
 *
 * Everything is real. `tugutil dash bind` runs through the card's own `$` shell
 * route (the route that stamps `TUG_SESSION_ID`), and the row appears because
 * the dash's `bound_sessions` moved in the account-global aggregate the Cards
 * projection now takes as an input. `dash unbind` takes it away the same way,
 * and the title's run comes back with it — which is the round trip that proves
 * the sub-row is derived on every recompose rather than latched at first sight.
 *
 * @covers tugdeck/src/components/lens/sections/cards-data-source.ts
 * @covers tugdeck/src/components/lens/sections/cards-section.tsx
 * @covers tugdeck/src/components/lens/sections/cards-session-cell.tsx
 * @covers tugdeck/src/components/lens/sections/dash-facts.tsx
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { launchTugApp, note, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";
import { createDash, releaseDash, tugutilPath } from "./dash-fixture";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const SID = "at0424-session";
const CARD = '[data-card-id="A"]';
const PROMPT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const SHELL_ROWS = `${CARD} [data-slot="session-transcript-shell-row"]`;

const CARDS = '.lens-section[data-lens-section="cards"]';
const SESSION_ROW = `${CARDS} [data-session-id="${SID}"]`;
const SESSION_ROW_DASH = `${SESSION_ROW} [data-slot="session-identity-dash"]`;
const DASH_NAME = "at0424-sub";
const SUBROW = `${CARDS} [data-slot="lens-cards-dash-subrow"][data-dash="${DASH_NAME}"]`;

const PROJECT_DIR = realpathSync(resolve(import.meta.dir, "..", ".."));

beforeAll(() => {
  if (!SHOULD_RUN) return;
  createDash(PROJECT_DIR, DASH_NAME, "at0424 fixture");
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

/** Run `command` through the card's `$` shell route and wait for its exit. */
async function shellAndSettle(
  app: App,
  command: string,
  expectedIndex = 0,
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

const dashRunsOnSessionRow = (app: App): Promise<number> =>
  app.evalJS<number>(
    `document.querySelectorAll(${JSON.stringify(SESSION_ROW_DASH)}).length`,
  );

describe.skipIf(!SHOULD_RUN)("AT0424: the Lens dash sub-row", () => {
  test(
    "binding nests the dash under its session; unbinding takes it away",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath, { sourceTreePath: PROJECT_DIR });
      const app = await launchTugApp({
        testName: "at0424-lens-dash-subrow",
        env: { TUGBANK_PATH: tugbankPath },
      });
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
        app.seedLedger({
          sessions: [
            {
              session_id: SID,
              workspace_key: PROJECT_DIR,
              project_dir: PROJECT_DIR,
              card_id: "A",
              name: "at0424 work",
            },
          ],
        });

        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SESSION_ROW)}) !== null`,
          { timeoutMs: 20000 },
        );
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(SUBROW)}).length`,
          ),
        ).toBe(0);

        // ── Bind, for real ────────────────────────────────────────────────
        await shellAndSettle(app, `${tugutilPath(PROJECT_DIR)} dash bind ${DASH_NAME}`);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SUBROW)}) !== null`,
          { timeoutMs: 30000 },
        );

        const sub = await app.evalJS<{
          text: string;
          glyphs: number;
          followsSession: boolean;
          cellIndexes: number[];
          indented: boolean;
        }>(
          `(() => {
             const row = document.querySelector(${JSON.stringify(SUBROW)});
             const session = document.querySelector(${JSON.stringify(SESSION_ROW)});
             const idx = (el) => {
               const cell = el.closest(".tug-list-view-cell");
               return cell === null
                 ? -1
                 : Number(cell.getAttribute("data-tug-list-cell-index"));
             };
             const iSession = idx(session);
             const iDash = idx(row);
             const content = row.querySelector(".tug-list-row-content");
             return {
               text: (row.querySelector(".lens-dashes-facts")?.textContent ?? "").trim(),
               glyphs: row.querySelectorAll(".lens-cards-dash-glyph svg").length,
               followsSession: iSession >= 0 && iDash === iSession + 1,
               cellIndexes: [iSession, iDash],
               indented:
                 content !== null &&
                 parseFloat(getComputedStyle(content).paddingInlineStart) > 0,
             };
           })()`,
        );
        note("at0424 sub-row", JSON.stringify(sub));
        expect(sub.text).toContain(DASH_NAME);
        // A freshly created dash with no round and no dirt is `created`.
        expect(sub.text).toContain("created");
        expect(sub.glyphs).toBe(1);
        // Directly under the session it is a fact about, and indented like the
        // stacked-card subrows — the step is what marks it as nested.
        expect(sub.followsSession).toBe(true);
        expect(sub.indented).toBe(true);

        // The row above says the dash exactly once, and the sub-row is where.
        expect(await dashRunsOnSessionRow(app)).toBe(0);
        note("at0424 lens with the sub-row", (await app.screenshot()).path);

        // ── Unbind, for real ──────────────────────────────────────────────
        await shellAndSettle(app, `${tugutilPath(PROJECT_DIR)} dash unbind`, 1);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(SUBROW)}).length === 0`,
          { timeoutMs: 30000 },
        );
        expect(await dashRunsOnSessionRow(app)).toBe(0);
      } finally {
        await app.close();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
