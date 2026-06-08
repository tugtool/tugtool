/**
 * at0147-question-nav-focus.test.ts — QuestionDialog wizard nav keeps keyboard
 * focus on the pressed Back/Next button across a Return, shifting only at the
 * boundaries ([P16] card-modal refinement).
 *
 * Rules (user, by-eye):
 *  - Return on **Next** stays on Next, unless there is no next question (review):
 *    then it shifts to **Submit** (all answered) or **Back** (not).
 *  - Return on **Back** stays on Back, unless there is no previous question
 *    (first row): then it shifts to **Next**.
 *
 * Driven with three MULTI-select questions (no auto-advance, so Next/Back drive
 * every step deterministically; each preseeds its first option, so once visited
 * every question is answered and the Next-boundary lands on Submit).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0147-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const DIALOG = `${CARD} [data-slot="dev-question-dialog"]`;
const NAV = `${DIALOG} .dev-question-dialog-nav-buttons`;
const SUBMIT = `${DIALOG} .tug-inline-dialog-actions .tug-button-primary-action`;
const CURRENT_HEADING = `${DIALOG} .dev-question-dialog-row[data-status="current"] .dev-question-dialog-row-heading`;

function controlRequestForward(): Record<string, unknown> {
  const q = (question: string) => ({
    question,
    multiSelect: true,
    options: [{ label: `${question}-x` }, { label: `${question}-y` }],
  });
  return {
    type: "control_request_forward",
    tug_session_id: SID,
    request_id: "at0147-q-1",
    is_question: true,
    input: { questions: [q("Alpha"), q("Bravo"), q("Charlie")] },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// data-key-view-kbd on nav button [0]=Back, [1]=Next.
function navKeyView(app: App, index: number): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var els=document.querySelectorAll(${JSON.stringify(`${NAV} [data-slot="tug-push-button"]`)});var el=els[${index}];return el!=null && el.hasAttribute("data-key-view-kbd");})()`,
  );
}

function hasAttr(app: App, selector: string, attr: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el!==null && el.hasAttribute(${JSON.stringify(attr)});})()`,
  );
}

function currentHeading(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){var el=document.querySelector(${JSON.stringify(CURRENT_HEADING)});return el?el.textContent:null;})()`,
  );
}

// Tab (up to `max` presses) until predicate() is true.
async function tabUntil(app: App, predicate: () => Promise<boolean>, max = 6): Promise<boolean> {
  for (let i = 0; i < max; i += 1) {
    if (await predicate()) return true;
    await app.nativeKey("Tab");
    await sleep(140);
  }
  return predicate();
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

describe.skipIf(!SHOULD_RUN)("AT0147: question wizard nav keeps focus on Back/Next", () => {
  test(
    "Next stays then →Submit at review; Back stays then →Next at first row",
    async () => {
      const app = await launchTugApp({ testName: "at0147-question-nav-focus" });
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
            msg_id: "at0147-msg-1",
            text: "Questions…",
            is_partial: true,
            rev: 0,
            seq: 0,
          },
        });
        await app.driveDevSession("A", {
          op: "ingestFrame",
          feedId: FEED_CODE_OUTPUT,
          decoded: controlRequestForward(),
        });

        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DIALOG)}) !== null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        expect((await currentHeading(app))?.includes("Alpha"), "opens on Alpha").toBe(true);

        // Tab to Next.
        expect(await tabUntil(app, () => navKeyView(app, 1)), "Tab reaches Next").toBe(true);

        // Return on Next → advance to Bravo; focus STAYS on Next.
        await app.nativeKey("Return");
        await sleep(160);
        expect((await currentHeading(app))?.includes("Bravo"), "Next advances to Bravo").toBe(true);
        expect(await navKeyView(app, 1), "focus stays on Next after advance").toBe(true);

        // Return on Next → advance to Charlie; still on Next.
        await app.nativeKey("Return");
        await sleep(160);
        expect((await currentHeading(app))?.includes("Charlie"), "Next advances to Charlie").toBe(true);
        expect(await navKeyView(app, 1), "focus stays on Next on the second advance").toBe(true);

        // Return on Next from the last question → review; Next is gone, so focus
        // shifts to Submit (every question is answered: preseeded + visited).
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(SUBMIT)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 4000 },
        );
        expect(await hasAttr(app, SUBMIT, "data-key-view-kbd"), "Next-boundary shifts to Submit").toBe(true);

        // Tab to Back, then walk it backward — focus STAYS on Back until the
        // first row, where Back is gone and focus shifts to Next.
        expect(await tabUntil(app, () => navKeyView(app, 0)), "Tab reaches Back").toBe(true);

        // Back → Charlie; stays on Back.
        await app.nativeKey("Return");
        await sleep(160);
        expect((await currentHeading(app))?.includes("Charlie"), "Back returns to Charlie").toBe(true);
        expect(await navKeyView(app, 0), "focus stays on Back").toBe(true);

        // Back → Bravo; still on Back.
        await app.nativeKey("Return");
        await sleep(160);
        expect((await currentHeading(app))?.includes("Bravo"), "Back returns to Bravo").toBe(true);
        expect(await navKeyView(app, 0), "focus stays on Back on the second step").toBe(true);

        // Back → Alpha (first row); Back is now gone, focus shifts to Next.
        await app.nativeKey("Return");
        await sleep(160);
        expect((await currentHeading(app))?.includes("Alpha"), "Back returns to Alpha").toBe(true);
        expect(await navKeyView(app, 1), "Back-boundary shifts to Next").toBe(true);

        process.stdout.write("VERDICT: PASS\n");
      } catch (err) {
        process.stdout.write("VERDICT: FAIL\n");
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0147-question-nav-focus] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
