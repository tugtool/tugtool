/**
 * at0407-lens-dashes-section.test.ts — the Lens's Dashes section over a real
 * dash, through the parked → worked transition and out to the card.
 *
 * A dash with no live session mated to it is *parked*, and the section says so
 * with a quiet glyph rather than a dot at rest — "nobody is working this" is
 * not a state of work, and a pulsing dot on an abandoned dash is the lie this
 * pins against. Binding a real session through the card's `$` shell route
 * turns the mark into a phase dot, live, on the `bind_dash_ok` broadcast plus
 * the aggregate recompose it fires.
 *
 * The section is the roster now, and carries no per-session jump chips: those
 * were how a reader got TO the session working a dash, and the Cards section's
 * dash sub-row is already there. Activating the ROW is the one gesture left —
 * it dispatches `focus-session-card`, and the card working the dash becomes
 * the active one. The Lens is the active card until then, which is what makes
 * the assertion mean something.
 *
 * And back again: `dash unbind` returns the row to the parked mark. The round
 * trip is the point — the mark is derived from the live bindings on every
 * recompose rather than latched at first sight, so a dash whose last worker
 * walks away goes quiet on its own.
 *
 * A second dash carries the review mark. Its plan is real, recorded by the
 * real `dash step start --plan` and stamped by the real `plan stamp`, and it
 * goes stale the way a plan actually goes stale: somebody edits it after the
 * review. Reviewed paints nothing — a mark that is always present is not a
 * mark — so the transition, not the presence, is what this asserts.
 *
 * @covers tugdeck/src/components/lens/sections/dashes-section.tsx
 * @covers tugdeck/src/lib/changeset-all-store.ts
 * @covers tugdeck/src/lib/changeset-types.ts
 * @covers tugdeck/src/lib/dash-review.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { launchTugApp, note, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";
import {
  createDash,
  makePlanStale,
  recordStampedPlan,
  releaseDash,
  tugutilPath,
} from "./dash-fixture";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const SID = "at0407-session";
const CARD = '[data-card-id="A"]';
const PROMPT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const SHELL_ROWS = `${CARD} [data-slot="session-transcript-shell-row"]`;

const SECTION = '.lens-section[data-lens-section="dashes"]';
const DASH_NAME = "at0407-lens";
const ROW = `${SECTION} [data-slot="lens-dashes-row"][data-dash="${DASH_NAME}"]`;
const PARKED = `${ROW} [data-slot="lens-dashes-parked"]`;
const DOT = `${ROW} [data-slot="tug-progress-indicator"]`;

/** The review mark's own dash — a second one, so the parked/worked test above
 *  keeps reading a dash with no plan at all (which paints nothing, ever). */
const PLAN_DASH = "at0407-plan";
const PLAN_ROW = `${SECTION} [data-slot="lens-dashes-row"][data-dash="${PLAN_DASH}"]`;
const PLAN_MARK = `${PLAN_ROW} [data-slot="lens-dashes-review"]`;

const PROJECT_DIR = realpathSync(resolve(import.meta.dir, "..", ".."));
let planPath = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  createDash(PROJECT_DIR, DASH_NAME, "at0407 fixture");
  const planned = createDash(PROJECT_DIR, PLAN_DASH, "at0407 plan fixture");
  planPath = recordStampedPlan(PROJECT_DIR, PLAN_DASH, planned.worktree);
});

afterAll(() => {
  if (!SHOULD_RUN) return;
  releaseDash(PROJECT_DIR, DASH_NAME);
  releaseDash(PROJECT_DIR, PLAN_DASH);
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

/** Run `command` through the card's `$` shell route — the route that stamps
 *  `TUG_SESSION_ID`, without which a bind resolves no session at all. */
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

describe.skipIf(!SHOULD_RUN)("AT0407: the Lens Dashes section", () => {
  test(
    "a parked dash wears the quiet mark; binding a session gives it a dot, and the row fronts the card",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath, { sourceTreePath: PROJECT_DIR });
      const app = await launchTugApp({
        testName: "at0407-lens-dashes-section",
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
              name: "at0407 work",
            },
          ],
        });

        // ── The section is there, and the dash in it is parked ─────────────
        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SECTION)}) !== null`,
          { timeoutMs: 15000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(ROW)}) !== null`,
          { timeoutMs: 30000 },
        );
        const parked = await app.evalJS<{
          text: string;
          marks: number;
          dots: number;
          flag: string | null;
        }>(
          `(() => {
             const row = document.querySelector(${JSON.stringify(ROW)});
             return {
               text: (row.querySelector(".lens-dashes-facts")?.textContent ?? "").trim(),
               marks: row.querySelectorAll('[data-slot="lens-dashes-parked"]').length,
               dots: row.querySelectorAll('[data-slot="tug-progress-indicator"]').length,
               flag: row.getAttribute("data-parked"),
             };
           })()`,
        );
        expect(parked.text).toContain(DASH_NAME);
        // A freshly created dash with no round and no dirt is `created`.
        expect(parked.text).toContain("created");
        expect(parked.marks).toBe(1);
        expect(parked.dots).toBe(0);
        expect(parked.flag).toBe("true");

        // The Lens is the active card — so a later "A" reading can only come
        // from the row activation.
        expect(await app.evalJS<string | null>(`window.__tug.getActiveCardId()`)).not.toBe(
          "A",
        );

        // ── Bind for real: the parked mark becomes a phase dot ─────────────
        await shellAndSettle(app, `${tugutilPath(PROJECT_DIR)} dash bind ${DASH_NAME}`);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DOT)}) !== null`,
          { timeoutMs: 30000 },
        );
        const worked = await app.evalJS<{ marks: number; flag: string | null; dots: number }>(
          `(() => {
             const row = document.querySelector(${JSON.stringify(ROW)});
             return {
               marks: row.querySelectorAll(${JSON.stringify(`[data-slot="lens-dashes-parked"]`)}).length,
               flag: row.getAttribute("data-parked"),
               dots: row.querySelectorAll('[data-slot="tug-progress-indicator"]').length,
             };
           })()`,
        );
        expect(worked.marks).toBe(0);
        expect(worked.flag).toBeNull();
        expect(worked.dots).toBe(1);

        // ── Activating the ROW fronts the card working the dash ───────────
        // The section's one gesture now that the jump chips are retired: the
        // row IS the dash, so the row is what acts on it.
        // The shell exchange put the first responder back in the card's
        // composer, so re-raise the Lens before clicking inside it.
        await app.dispatchControlAction("focus-lens");
        await app.nativeClickAtElement(ROW);
        await app.waitForCondition<boolean>(
          `window.__tug.getActiveCardId() === "A"`,
          { timeoutMs: 8000 },
        );

        // ── And back: unmated, the dash is parked again ───────────────────
        // The round trip is the point — the mark is derived from the live
        // bindings on every recompose, not latched at first sight, so a dash
        // whose last worker walks away goes quiet on its own.
        await shellAndSettle(app, `${tugutilPath(PROJECT_DIR)} dash unbind`, 1);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(PARKED)}) !== null`,
          { timeoutMs: 30000 },
        );
        expect(await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(DOT)}).length`,
        )).toBe(0);
      } finally {
        await app.close();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a plan edited past its stamp grows the stale mark on its dash's row",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath, { sourceTreePath: PROJECT_DIR });
      const app = await launchTugApp({
        testName: "at0407-lens-dashes-review",
        env: { TUGBANK_PATH: tugbankPath },
      });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(PLAN_ROW)}) !== null`,
          { timeoutMs: 30000 },
        );

        // Reviewed reads as nothing at all: a mark that is always present is
        // not a mark. The ledger row `dash step start` flipped is outside the
        // hashed content, which is what makes this assertion meaningful rather
        // than accidental.
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(PLAN_MARK)}).length`,
          ),
        ).toBe(0);

        // One appended line moves the document past its stamp. Touching a
        // tracked project file is what wakes the aggregate for the recompose
        // that carries the new state onto the entry.
        makePlanStale(planPath);
        const nudge = join(PROJECT_DIR, "at0407-nudge.txt");
        writeFileSync(nudge, "at0407 recompose nudge\n");
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(PLAN_MARK)}) !== null`,
            { timeoutMs: 30000 },
          );
        } finally {
          rmSync(nudge, { force: true });
        }

        const mark = await app.evalJS<{ review: string | null; label: string | null }>(
          `(() => {
             const el = document.querySelector(${JSON.stringify(PLAN_MARK)});
             return {
               review: el.getAttribute("data-review"),
               label: el.getAttribute("aria-label"),
             };
           })()`,
        );
        expect(mark.review).toBe("stale");
        expect(mark.label).toContain("changed since");
        note("at0407 stale mark", await app.screenshot().then((s) => s.path));

        // ── The ordering, in the DOM ──────────────────────────────────────
        // Both fixtures are parked, so the stage rank decides: this dash is
        // `implementing` (a step is open on it), the other is `created`.
        const order = await app.evalJS<string[]>(
          `Array.from(
             document.querySelectorAll(${JSON.stringify(`${SECTION} [data-slot="lens-dashes-row"]`)}),
           ).map((el) => el.getAttribute("data-dash"))`,
        );
        expect(order.indexOf(PLAN_DASH)).toBeGreaterThanOrEqual(0);
        expect(order.indexOf(DASH_NAME)).toBeGreaterThanOrEqual(0);
        expect(order.indexOf(PLAN_DASH)).toBeLessThan(order.indexOf(DASH_NAME));
      } finally {
        await app.close();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
