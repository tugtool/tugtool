/**
 * at0203-dialog-focus-on-card-click-back.test.ts — clicking away from a
 * card with a pending card-modal dialog and clicking back re-establishes
 * the dialog content as the card's focus destination ([P20]/[P21]).
 *
 * ## Why this exists
 *
 * The resting activation story is settled: clicking a deactivated dev
 * card lands focus (the caret) on its prompt entry, for every click
 * target (at0201). The MODAL state must behave the same way: while a
 * QuestionDialog / PermissionDialog is pending the card's focus
 * destination is the dialog's pushed key view — so the click that brings
 * the card back must land the keyboard there (the options item-group /
 * the recommended default button), ringed and arrow-walkable, with zero
 * extra work. at0148 pins this for the app-level boundary (window
 * blur→focus); this test pins the CARD-level boundary (cross-card
 * activation click), which routes through a different path
 * (`pane-focus-controller` → `transferFocusForActivation` →
 * `applyBagFocus` → `adoptKeyCard`).
 *
 * Both dialog kinds are pinned, for both click-back targets (title bar
 * and card content):
 *
 *  - QuestionDialog: the options item-group re-holds the key view with
 *    the keyboard ring (`data-key-view-kbd`), the trap mode is current,
 *    and the scrim signal is present.
 *  - PermissionDialog: Allow (the recommended default) re-holds the key
 *    view with the ring.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const FEED_CODE_OUTPUT = 0x40;
const PROMPT_INPUT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

const CARD_A = '[data-card-id="A"]';
const CARD_A_ROOT = `${CARD_A} [data-slot="dev-card"]`;
const Q_DIALOG = `${CARD_A} [data-slot="dev-question-dialog"]`;
const Q_OPTIONS = `${Q_DIALOG} .dev-question-dialog-options-list`;
const P_DIALOG = `${CARD_A} [data-slot="dev-permission-dialog"]`;
const P_ALLOW = `${P_DIALOG} .tug-inline-dialog-actions .tug-button-primary-action`;

function paneTitleSelectorFor(paneId: string): string {
  return `[data-pane-id="${paneId}"] [data-testid="tug-pane-title"]`;
}

const twoDevPanes = {
  cards: [
    { id: "A", componentId: "dev", title: "Dev A", closable: true },
    { id: "B", componentId: "dev", title: "Dev B", closable: true },
  ],
  panes: [
    {
      id: "p1",
      position: { x: 40, y: 40 },
      size: { width: 560, height: 520 },
      cardIds: ["A"],
      activeCardId: "A",
      title: "",
      acceptsFamilies: ["developer"],
    },
    {
      id: "p2",
      position: { x: 640, y: 40 },
      size: { width: 560, height: 520 },
      cardIds: ["B"],
      activeCardId: "B",
      title: "",
      acceptsFamilies: ["developer"],
    },
  ],
  activePaneId: "p1",
  hasFocus: true,
};

function hasAttr(app: App, selector: string, attr: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el!==null && el.hasAttribute(${JSON.stringify(attr)});})()`,
  );
}

function activeElementInCard(cardId: string): string {
  return `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="${cardId}"]') !== null`;
}

async function launchAndSeed(testName: string): Promise<App> {
  const app = await launchTugApp({ testName });
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: twoDevPanes, focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
  );
  await app.bindDevSession("A", { tugSessionId: "at0203-session-a" });
  await app.awaitEngineReady("A");
  await app.bindDevSession("B");
  await app.awaitEngineReady("B");
  return app;
}

async function presentQuestion(app: App): Promise<void> {
  const sid = "at0203-session-a";
  await app.driveDevSession("A", { op: "send", text: "ask me" });
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: {
      type: "assistant_text",
      tug_session_id: sid,
      msg_id: "at0203-msg-1",
      text: "Questions…",
      is_partial: true,
      rev: 0,
      seq: 0,
    },
  });
  const forward = {
    type: "control_request_forward",
    tug_session_id: sid,
    request_id: "at0203-q-1",
    tool_use_id: "at0203-tu-1",
    is_question: true,
    input: {
      questions: [
        {
          question: "Pick one?",
          multiSelect: false,
          options: [{ label: "Alpha" }, { label: "Beta" }],
        },
      ],
    },
  };
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: {
      type: "tool_use",
      tug_session_id: sid,
      msg_id: "at0203-msg-1",
      tool_use_id: forward.tool_use_id,
      tool_name: "AskUserQuestion",
      input: forward.input,
      seq: 1,
    },
  });
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: forward,
  });
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(Q_DIALOG)}) !== null`,
    { timeoutMs: 6000 },
  );
}

async function presentPermission(app: App): Promise<void> {
  const sid = "at0203-session-a";
  await app.driveDevSession("A", { op: "send", text: "count lines" });
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: {
      type: "assistant_text",
      tug_session_id: sid,
      msg_id: "at0203-msg-1",
      text: "Running tokei…",
      is_partial: true,
      rev: 0,
      seq: 0,
    },
  });
  await app.driveDevSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: {
      type: "control_request_forward",
      tug_session_id: sid,
      request_id: "at0203-perm-1",
      is_question: false,
      tool_name: "Bash",
      input: { command: "tokei" },
      permission_suggestions: [
        {
          behavior: "allow",
          destination: "project",
          type: "addRules",
          rules: [{ toolName: "Bash" }],
        },
      ],
    },
  });
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(P_DIALOG)}) !== null`,
    { timeoutMs: 6000 },
  );
}

/** Click pane 2 (activates B and lands its editor caret), deactivating A. */
async function clickAwayToB(app: App): Promise<void> {
  await app.nativeClickAtElement(paneTitleSelectorFor("p2"));
  await app.waitForCondition<boolean>(activeElementInCard("B"), {
    timeoutMs: 3000,
  });
}

/** The dialog's key stop is ringed, the trap is current, the scrim is up. */
async function assertModalSeeded(
  app: App,
  keyStop: string,
  when: string,
): Promise<void> {
  expect(
    await hasAttr(app, keyStop, "data-key-view-kbd"),
    `${when}: the dialog's key stop holds the keyboard ring`,
  ).toBe(true);
  expect(
    await app.evalJS<boolean>(
      `document.documentElement.hasAttribute("data-focus-mode")`,
    ),
    `${when}: a trapped focus mode is current`,
  ).toBe(true);
  expect(
    await hasAttr(app, CARD_A_ROOT, "data-inline-dialog-pending"),
    `${when}: the card carries the scrim signal`,
  ).toBe(true);
}

/** Wait for the key stop's ring, then run the full modal assertion. */
async function awaitModalSeeded(
  app: App,
  keyStop: string,
  when: string,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){var el=document.querySelector(${JSON.stringify(keyStop)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
    { timeoutMs: 4000 },
  );
  await assertModalSeeded(app, keyStop, when);
}

describe.skipIf(!SHOULD_RUN)(
  "AT0203: card click-away / click-back re-focuses the pending dialog",
  () => {
    test(
      "question dialog: TITLE BAR click-back re-seeds the options ring",
      async () => {
        const app = await launchAndSeed("at0203-question-title");
        try {
          await presentQuestion(app);
          await awaitModalSeeded(app, Q_OPTIONS, "on open");

          await clickAwayToB(app);
          await app.nativeClickAtElement(paneTitleSelectorFor("p1"));
          await awaitModalSeeded(app, Q_OPTIONS, "after title-bar click-back");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0203] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "question dialog: CARD CONTENT click-back re-seeds the options ring",
      async () => {
        const app = await launchAndSeed("at0203-question-content");
        try {
          await presentQuestion(app);
          await awaitModalSeeded(app, Q_OPTIONS, "on open");

          await clickAwayToB(app);
          // Click card content ABOVE the dialog (the scrimmed transcript top),
          // not the dialog's own controls — a bare "bring this card back"
          // click, the shape the bug was reported against.
          const pt = await app.evalJS<{ x: number; y: number }>(
            `(function(){
              var el = document.querySelector('[data-pane-id="p1"] .tug-pane-content');
              var r = el.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + 40 };
            })()`,
          );
          await app.nativeClick(pt);
          await awaitModalSeeded(app, Q_OPTIONS, "after content click-back");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0203] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "permission dialog: TITLE BAR click-back re-seeds Allow's ring",
      async () => {
        const app = await launchAndSeed("at0203-permission-title");
        try {
          await presentPermission(app);
          await awaitModalSeeded(app, P_ALLOW, "on open");

          await clickAwayToB(app);
          await app.nativeClickAtElement(paneTitleSelectorFor("p1"));
          await awaitModalSeeded(app, P_ALLOW, "after title-bar click-back");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0203] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
