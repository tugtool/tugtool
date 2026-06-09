/**
 * at0146-question-dialog-keyboard.test.ts — the QuestionDialog is **card-modal**:
 * inline display, trapped focus, archetype-decomposed controls, scrimmed
 * surround, no dead-zone ([P16]/[P17]/[P18]/[P19]).
 *
 * Mirrors the PermissionDialog redesign (at0145) for the AskUserQuestion wizard.
 * The dialog keeps its inline render but its controls are decomposed into
 * focus-language archetypes inside the trap: Cancel / Submit (and Back / Next on
 * multi-question payloads) are leaf buttons; the current question's options are a
 * single item-group stop (Tab to the group, arrows move a cursor, Space/Enter
 * pick). The old full-width `dev-question-dialog-scope` dead-zone is gone.
 *
 * Driven with a single MULTI-select question (no auto-advance, so the sequence
 * is deterministic): the options group seeds as the key view; ArrowDown moves
 * the cursor; Space toggles the cursor option on (enabling Submit); Tab reaches
 * Submit without escaping to the editor; Return submits and the dialog
 * dismisses.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0146-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const CARD_ROOT = `${CARD} [data-slot="dev-card"]`;
const DIALOG = `${CARD} [data-slot="dev-question-dialog"]`;
const SUBMIT = `${DIALOG} .tug-inline-dialog-actions .tug-button-primary-action`;
// The options are a flush TugListView authored into the trap as one item-group
// stop: the list (its scroll container) holds the key view; the movement cursor
// (`data-key-cursor`) lands on a `.tug-list-view-cell`; the committed selection
// (`data-selected`) lands on the `TugListRow` inside it.
const OPTIONS = `${DIALOG} [data-slot="tug-list-view"]`;
const OPTION_CELLS = `${OPTIONS} .tug-list-view-cell`;
const OPTION_ROWS = `${OPTIONS} [data-slot="tug-list-row"]`;
const OLD_DEADZONE = `${CARD} [data-slot="dev-question-dialog-scope"]`;
const EDITOR = `${CARD} [data-slot="tug-text-editor"] .cm-content`;

function controlRequestForward(): Record<string, unknown> {
  return {
    type: "control_request_forward",
    tug_session_id: SID,
    request_id: "at0146-q-1",
    is_question: true,
    input: {
      questions: [
        {
          question: "Pick any that apply",
          header: "Pick",
          multiSelect: true,
          options: [{ label: "Alpha" }, { label: "Beta" }],
        },
      ],
    },
  };
}

function hasAttr(app: App, selector: string, attr: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el!==null && el.hasAttribute(${JSON.stringify(attr)});})()`,
  );
}

function exists(app: App, selector: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.querySelector(${JSON.stringify(selector)}) !== null`,
  );
}

// Whether the element at `index` of `listSelector` carries the given attribute.
function nthHasAttr(
  app: App,
  listSelector: string,
  index: number,
  attr: string,
): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var els=document.querySelectorAll(${JSON.stringify(listSelector)});var el=els[${index}];return el!=null && el.hasAttribute(${JSON.stringify(attr)});})()`,
  );
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!SHOULD_RUN)("AT0146: QuestionDialog is card-modal", () => {
  test(
    "options item-group seeded; arrows move; Space toggles; Tab to Submit; Return submits",
    async () => {
      const app = await launchTugApp({ testName: "at0146-question-dialog-keyboard" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        await app.driveDevSession("A", { op: "send", text: "ask me something" });
        await app.driveDevSession("A", {
          op: "ingestFrame",
          feedId: FEED_CODE_OUTPUT,
          decoded: {
            type: "assistant_text",
            tug_session_id: SID,
            msg_id: "at0146-msg-1",
            text: "Let me ask…",
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

        // (1) The dead-zone is gone ([P18]); the card carries the scrim signal ([P19]).
        expect(await exists(app, OLD_DEADZONE), "old scope dead-zone is gone").toBe(false);
        expect(
          await hasAttr(app, CARD_ROOT, "data-inline-dialog-pending"),
          "card root carries the scrim signal while pending",
        ).toBe(true);

        // (2) On open the options item-group holds the key view (answering is the task).
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(OPTIONS)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 4000 },
        );

        // (3) ArrowDown moves the cursor to the second option (no commit on move).
        await app.nativeKey("ArrowDown");
        await sleep(150);
        expect(
          await nthHasAttr(app, OPTION_CELLS, 1, "data-key-cursor"),
          "ArrowDown moves the cursor to the second option",
        ).toBe(true);

        // (4) Space toggles the cursor option ON (multi-select), enabling Submit.
        await app.nativeKey(" ");
        await sleep(150);
        expect(
          await nthHasAttr(app, OPTION_ROWS, 1, "data-selected"),
          "Space toggles the second option selected",
        ).toBe(true);

        // (5) The trap holds: Tab cycles to Submit and never lands on the editor.
        let onSubmit = false;
        for (let i = 0; i < 5 && !onSubmit; i += 1) {
          await app.nativeKey("Tab");
          await sleep(150);
          expect(
            await hasAttr(app, EDITOR, "data-key-view-kbd"),
            "Tab never escapes the trap to the editor",
          ).toBe(false);
          onSubmit = await hasAttr(app, SUBMIT, "data-key-view-kbd");
        }
        expect(onSubmit, "Tab reaches the Submit button").toBe(true);

        // (6) Return on the focused Submit submits → the dialog dismisses.
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DIALOG)}) === null`,
          { timeoutMs: 4000 },
        );
        expect(await exists(app, DIALOG), "Return on Submit dismisses the dialog").toBe(false);

        process.stdout.write("VERDICT: PASS\n");
      } catch (err) {
        process.stdout.write("VERDICT: FAIL\n");
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0146-question-dialog-keyboard] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
