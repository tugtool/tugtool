/**
 * at0161-question-dialog-geometry.test.ts — the QuestionDialog's geometry is
 * CONSTANT across the whole wizard walk.
 *
 * The dialog sits at the transcript's live edge, so any height change or
 * content relocation mid-wizard shoves the scroll under the user's eye. The
 * master–detail layout guarantees three invariants, each pinned here against
 * the real app at every wizard step (Q1 → Q2 → Q3 → review → back to Q1):
 *
 *  1. the dialog's outer box never changes height;
 *  2. the stationary options panel never moves (same top, same height) —
 *     including at the review step, which fills the panel instead of
 *     collapsing it. The panel top is measured relative to the dialog's
 *     top: reaching review deliberately scrolls the transcript (the
 *     action-bar reveal, see at0202), so viewport coordinates would
 *     conflate that intended scroll with a layout shift;
 *  3. the rail never changes height as rows change status (every row
 *     reserves its one-line `→ answer` slot in every status).
 *
 * Driven through the Next / Back buttons (`element.click()` — the wizard's
 * own commit-and-advance path) with a question mix that exercises the sizer
 * floor: differing option counts, a multi-select question, and option
 * descriptions long enough to wrap.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0161-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const DIALOG = `${CARD} [data-slot="dev-question-dialog"]`;
const RAIL = `${DIALOG} .dev-question-dialog-rail`;
const PANEL = `${DIALOG} [data-slot="dev-question-dialog-panel"]`;
// Back/Next live in the top action bar; they are the only outlined-action
// buttons, so this selects exactly [Back, Next] for clickNav([0]=Back, [1]=Next).
const NAV_BUTTONS = `${DIALOG} .dev-question-dialog-actionbar-buttons .tug-button-outlined-action`;
const CURRENT_ROW = `${DIALOG} .question-summary-row[data-status="current"]`;

function controlRequestForward(): Record<string, unknown> {
  return {
    type: "control_request_forward",
    tug_session_id: SID,
    request_id: "at0161-q-1",
    tool_use_id: "at0161-tu-1",
    is_question: true,
    input: {
      questions: [
        {
          question: "How should the calculator take input?",
          multiSelect: false,
          options: [
            {
              label: "Interactive REPL",
              description:
                "The program loops, reading one expression per line and printing the result until the user quits — a long description that wraps across lines.",
            },
            { label: "Command-line args" },
            { label: "Both" },
          ],
        },
        {
          question: "What math should it support?",
          multiSelect: false,
          options: [{ label: "Precedence + parens" }, { label: "Flat left-to-right" }],
        },
        {
          question: "Which extras apply?",
          multiSelect: true,
          options: [
            { label: "History" },
            { label: "Variables" },
            { label: "Ans register" },
            { label: "Unit conversion" },
          ],
        },
      ],
    },
  };
}

// The AskUserQuestion tool_use that hosts the live wizard in place — the block
// only mounts when its tool call exists. Ingest BEFORE the forward; they share
// `tool_use_id`.
function toolUseFor(forward: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "tool_use",
    tug_session_id: SID,
    msg_id: "at0161-msg-1",
    tool_use_id: forward.tool_use_id,
    tool_name: "AskUserQuestion",
    input: forward.input,
    seq: 1,
  };
}

async function ingestQuestion(
  app: App,
  forward: Record<string, unknown>,
): Promise<void> {
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: toolUseFor(forward),
  });
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: forward,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Geometry {
  dialogHeight: number;
  railHeight: number;
  panelTop: number;
  panelHeight: number;
}

function readGeometry(app: App): Promise<Geometry> {
  return app.evalJS<Geometry>(
    `(function(){
      function rect(sel){var el=document.querySelector(sel);return el?el.getBoundingClientRect():null;}
      var d=rect(${JSON.stringify(DIALOG)});
      var r=rect(${JSON.stringify(RAIL)});
      var p=rect(${JSON.stringify(PANEL)});
      return {
        dialogHeight: d?d.height:-1,
        railHeight: r?r.height:-1,
        panelTop: (p&&d)?(p.top-d.top):-1,
        panelHeight: p?p.height:-1
      };
    })()`,
  );
}

// [index] 0=Back, 1=Next.
function clickNav(app: App, index: number): Promise<unknown> {
  return app.evalJS(
    `(function(){var els=document.querySelectorAll(${JSON.stringify(NAV_BUTTONS)});var el=els[${index}];if(el){el.click();return true;}return false;})()`,
  );
}

function currentStatusPresent(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.querySelector(${JSON.stringify(CURRENT_ROW)}) !== null`,
  );
}

/** Geometry equality with a 1px allowance for sub-pixel rounding. */
function expectSameGeometry(step: string, a: Geometry, b: Geometry): void {
  const detail = `was ${JSON.stringify(a)}, now ${JSON.stringify(b)}`;
  expect(Math.abs(b.dialogHeight - a.dialogHeight), `${step}: dialog height moved — ${detail}`).toBeLessThanOrEqual(1);
  expect(Math.abs(b.railHeight - a.railHeight), `${step}: rail height moved — ${detail}`).toBeLessThanOrEqual(1);
  expect(Math.abs(b.panelTop - a.panelTop), `${step}: panel top moved — ${detail}`).toBeLessThanOrEqual(1);
  expect(Math.abs(b.panelHeight - a.panelHeight), `${step}: panel height moved — ${detail}`).toBeLessThanOrEqual(1);
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 700 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("AT0161: question wizard geometry is constant", () => {
  test(
    "dialog / rail / panel boxes hold through Q1 → Q2 → Q3 → review → Back",
    async () => {
      const app = await launchTugApp({ testName: "at0161-question-dialog-geometry" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        await app.driveDevSession("A", { op: "send", text: "ask me" });
        await app.driveDevSession("A", {
          op: "ingestFrame",
          feedId: FEED_CODE_OUTPUT,
          decoded: {
            type: "assistant_text",
            tug_session_id: SID,
            msg_id: "at0161-msg-1",
            text: "Questions…",
            is_partial: true,
            rev: 0,
            seq: 0,
          },
        });
        await ingestQuestion(app, controlRequestForward());

        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DIALOG)}) !== null`,
          { timeoutMs: 6000 },
        );
        await sleep(250);

        const atQ1 = await readGeometry(app);
        expect(atQ1.dialogHeight, "dialog rendered").toBeGreaterThan(0);
        expect(atQ1.panelHeight, "panel rendered").toBeGreaterThan(0);

        // Q1 → Q2 → Q3 (Next is the wizard's commit-and-advance).
        await clickNav(app, 1); await sleep(200);
        const atQ2 = await readGeometry(app);
        expectSameGeometry("Q1→Q2", atQ1, atQ2);

        await clickNav(app, 1); await sleep(200);
        const atQ3 = await readGeometry(app);
        expectSameGeometry("Q2→Q3", atQ1, atQ3);

        // Q3 → review: no row is current; the panel fills with the review
        // notice instead of collapsing.
        await clickNav(app, 1); await sleep(200);
        expect(await currentStatusPresent(app), "review paints no current row").toBe(false);
        const atReview = await readGeometry(app);
        expectSameGeometry("Q3→review", atQ1, atReview);

        // review → Q3 (Back): the options return into the same box.
        await clickNav(app, 0); await sleep(200);
        expect(await currentStatusPresent(app), "Back re-opens a current row").toBe(true);
        const backAtQ3 = await readGeometry(app);
        expectSameGeometry("review→Q3", atQ1, backAtQ3);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0161-question-dialog-geometry] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
