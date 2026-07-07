/**
 * at0202-question-review-reveal.test.ts — reaching the question wizard's
 * review step reveals the action bar (Cancel / Submit).
 *
 * The wizard's action bar sits at the TOP of the dialog body. On a dialog
 * taller than the card's scrollport, the transcript opens pinned to the
 * live edge (the dialog's bottom), so the action bar starts off the top.
 * When the user answers the last question and the wizard enters review,
 * the dialog must scroll the action bar back into view — otherwise the
 * user is stranded staring at "Review your answers above, then Submit"
 * with no Submit reachable without a manual scroll.
 *
 * Two entry paths are pinned, matching the two ways a user commits the
 * last question:
 *
 *  1. `Next` click — the immediate advance path;
 *  2. Return on the options — the flash-then-advance path (the reveal
 *     must land after the selection flash completes).
 *
 * "Visible" is measured against the block's sticky `.tool-call-header`,
 * not just the scrollport: the stuck header overlays the scrollport's top
 * band, so an action bar aligned to the scrollport top edge is still
 * pixel-hidden. The reveal must clear the header's bottom.
 *
 * A third test pins the Submit default-ring gate: Submit must NOT wear
 * `data-default-ring` (Return's home) while a live question's options hold
 * the key view — Return there commits-and-advances, it does not submit.
 * Only when the wizard is done (single question: the commit lands the key
 * view ON Submit; multi: the review step) does Return really submit.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const SCROLLER = `${CARD} [data-tug-scroll-key="dev-card-transcript"]`;
const DIALOG = `${CARD} [data-slot="dev-question-dialog"]`;
const ACTIONBAR = `${DIALOG} [data-slot="dev-question-dialog-actionbar"]`;
const NAV_BUTTONS = `${DIALOG} .dev-question-dialog-actionbar-buttons .tug-button-outlined-action`;
const REVIEW_NOTICE = `${DIALOG} .dev-question-dialog-panel-review`;
const SUBMIT = `${DIALOG} .dev-question-dialog-actionbar-buttons .tug-button-primary-action`;
const OPTIONS = `${DIALOG} .dev-question-dialog-options-list`;

/** Long option descriptions so the dialog overflows the short pane. */
function longOptions(prefix: string): Array<Record<string, string>> {
  return [1, 2, 3, 4].map((n) => ({
    label: `${prefix} option ${n}`,
    description:
      "A deliberately long option description that wraps across multiple " +
      "lines in the panel so the dialog grows well past the card scrollport " +
      "height and the action bar starts scrolled off the top edge.",
  }));
}

function tallQuestions(): Array<Record<string, unknown>> {
  return [
    { question: "First tall question?", multiSelect: false, options: longOptions("First") },
    { question: "Second tall question?", multiSelect: false, options: longOptions("Second") },
    { question: "Third tall question?", multiSelect: false, options: longOptions("Third") },
  ];
}

function controlRequestForward(
  sid: string,
  questions: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    type: "control_request_forward",
    tug_session_id: sid,
    request_id: "at0202-q-1",
    tool_use_id: "at0202-tu-1",
    is_question: true,
    input: { questions },
  };
}

function toolUseFor(
  sid: string,
  forward: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "tool_use",
    tug_session_id: sid,
    msg_id: "at0202-msg-1",
    tool_use_id: forward.tool_use_id,
    tool_name: "AskUserQuestion",
    input: forward.input,
    seq: 1,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RevealState {
  scrollerTop: number;
  scrollerBottom: number;
  actionbarTop: number;
  actionbarBottom: number;
  /** Bottom edge of the block's sticky `.tool-call-header` — the header
   *  overlays the scrollport top while stuck, so this (not the scrollport
   *  top) is the line the action bar must clear to actually be seen. */
  headerBottom: number;
  dialogHeight: number;
  scrollerClientHeight: number;
}

function readRevealState(app: App): Promise<RevealState> {
  return app.evalJS<RevealState>(
    `(function(){
      var s = document.querySelector(${JSON.stringify(SCROLLER)});
      var a = document.querySelector(${JSON.stringify(ACTIONBAR)});
      var d = document.querySelector(${JSON.stringify(DIALOG)});
      var chrome = d ? d.closest('.tool-block-chrome') : null;
      var h = chrome ? chrome.querySelector('.tool-call-header') : null;
      var sr = s ? s.getBoundingClientRect() : { top: -1, bottom: -1 };
      var ar = a ? a.getBoundingClientRect() : { top: -1, bottom: -1 };
      var hr = h ? h.getBoundingClientRect() : { bottom: -1 };
      var dr = d ? d.getBoundingClientRect() : { height: -1 };
      return {
        scrollerTop: sr.top,
        scrollerBottom: sr.bottom,
        actionbarTop: ar.top,
        actionbarBottom: ar.bottom,
        headerBottom: hr.bottom,
        dialogHeight: dr.height,
        scrollerClientHeight: s ? s.clientHeight : -1
      };
    })()`,
  );
}

/** The action bar is genuinely visible: fully inside the scrollport's
 *  vertical band AND clear of the block's sticky header overlay with
 *  enough headroom for the buttons' outside-the-box focus/default ring
 *  (2px offset + 1.5px width, `focus-ring.css`) — flush would clip it. */
function actionbarVisible(state: RevealState): boolean {
  return (
    state.actionbarTop >= state.scrollerTop - 1 &&
    state.actionbarTop >= state.headerBottom + 4 &&
    state.actionbarBottom <= state.scrollerBottom + 1
  );
}

// [index] 0=Back, 1=Next.
function clickNav(app: App, index: number): Promise<unknown> {
  return app.evalJS(
    `(function(){var els=document.querySelectorAll(${JSON.stringify(NAV_BUTTONS)});var el=els[${index}];if(el){el.click();return true;}return false;})()`,
  );
}

function atReview(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.querySelector(${JSON.stringify(REVIEW_NOTICE)}) !== null`,
  );
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        // Short pane: the three tall questions overflow this scrollport,
        // so the action bar starts off the top while pinned to the bottom.
        size: { width: 820, height: 480 },
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

async function openQuestion(
  app: App,
  sid: string,
  questions: Array<Record<string, unknown>>,
): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.bindDevSession("A", { tugSessionId: sid });
  await app.awaitEngineReady("A");

  await app.driveDevSession("A", { op: "send", text: "ask me" });
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: {
      type: "assistant_text",
      tug_session_id: sid,
      msg_id: "at0202-msg-1",
      text: "Questions…",
      is_partial: true,
      rev: 0,
      seq: 0,
    },
  });
  const forward = controlRequestForward(sid, questions);
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: toolUseFor(sid, forward),
  });
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: forward,
  });

  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(DIALOG)}) !== null`,
    { timeoutMs: 6000 },
  );
  await sleep(300);

  // Park the view at the live edge — the state a real conversation is in
  // when the question streams in (the transcript follows the bottom while
  // Claude talks). The downward scroll-to-bottom also re-engages
  // follow-bottom via SmartScroll's idle re-engagement, so the reveal has
  // the same fight on its hands as in production.
  await app.evalJS(
    `(function(){
      var el = document.querySelector(${JSON.stringify(SCROLLER)});
      if (!el) return false;
      el.scrollTop = el.scrollHeight - el.clientHeight;
      el.dispatchEvent(new Event('scroll', { bubbles: false }));
      return true;
    })()`,
  );
  await sleep(300);
}

describe.skipIf(!SHOULD_RUN)("AT0202: review step reveals the action bar", () => {
  test(
    "Next through all questions — action bar scrolls back into view",
    async () => {
      const app = await launchTugApp({ testName: "at0202-question-review-reveal" });
      try {
        await openQuestion(app, "at0202-session-next", tallQuestions());

        const before = await readRevealState(app);
        expect(before.dialogHeight, "dialog rendered").toBeGreaterThan(0);
        // Precondition: the dialog overflows the scrollport and the action
        // bar starts off the top (pinned to the live edge). Without this the
        // reveal has nothing to prove.
        expect(
          before.dialogHeight,
          "dialog taller than scrollport",
        ).toBeGreaterThan(before.scrollerClientHeight);
        expect(
          actionbarVisible(before),
          `action bar starts off-screen — ${JSON.stringify(before)}`,
        ).toBe(false);

        // Q1 → Q2 → Q3 → review via Next.
        await clickNav(app, 1); await sleep(200);
        await clickNav(app, 1); await sleep(200);
        await clickNav(app, 1); await sleep(400);
        expect(await atReview(app), "wizard reached review").toBe(true);

        const after = await readRevealState(app);
        expect(
          actionbarVisible(after),
          `action bar revealed at review — ${JSON.stringify(after)}`,
        ).toBe(true);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0202] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "Return on the last question — reveal lands after the flash",
    async () => {
      const app = await launchTugApp({ testName: "at0202-question-review-reveal-return" });
      try {
        await openQuestion(app, "at0202-session-return", tallQuestions());

        const before = await readRevealState(app);
        expect(
          actionbarVisible(before),
          `action bar starts off-screen — ${JSON.stringify(before)}`,
        ).toBe(false);

        // The options list holds the key view on open; Return commits the
        // cursor option and advances (flash-then-advance). Three Returns
        // walk Q1 → Q2 → Q3 → review.
        for (let i = 0; i < 3; i += 1) {
          await app.nativeKey("Return");
          // Wait out the flash (duration-slow ~500ms) plus the advance.
          await sleep(900);
        }
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(REVIEW_NOTICE)}) !== null`,
          { timeoutMs: 6000 },
        );
        await sleep(300);

        const after = await readRevealState(app);
        expect(
          actionbarVisible(after),
          `action bar revealed at review — ${JSON.stringify(after)}`,
        ).toBe(true);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0202] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "Submit wears no default ring while a live question owns Return",
    async () => {
      const app = await launchTugApp({ testName: "at0202-question-submit-ring" });
      try {
        await openQuestion(app, "at0202-session-ring", [
          {
            question: "Only question?",
            multiSelect: false,
            options: [{ label: "Alpha" }, { label: "Beta" }],
          },
        ]);

        // The options item-group holds the key view on open; Return there
        // commits-and-advances, so Submit must NOT claim Return's home.
        expect(
          await app.evalJS<boolean>(
            `(function(){var el=document.querySelector(${JSON.stringify(OPTIONS)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
          ),
          "options hold the key view on open",
        ).toBe(true);
        expect(
          await app.evalJS<boolean>(
            `(function(){var el=document.querySelector(${JSON.stringify(SUBMIT)});return el!==null && el.hasAttribute("data-default-ring");})()`,
          ),
          "Submit carries no default ring mid-question",
        ).toBe(false);

        // Return commits the pick; after the flash the key view lands ON
        // Submit — a focused button, so Return now really submits.
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(SUBMIT)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 6000 },
        );

        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DIALOG)}) === null`,
          { timeoutMs: 6000 },
        );
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0202] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
