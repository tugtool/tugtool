/**
 * at0142-single-select-keyboard.test.ts — the single-select list keyboard model,
 * end-to-end through the real `/rewind` sheet.
 *
 * A single-select picker (the rewind turn list) is the focus engine's
 * "one selected row the arrows move" container:
 *   - On open the LIST is the key view (the ring rests on it, not the OK/Rewind
 *     button), and its first selectable row auto-selects (`seedSelection`), so
 *     the default action enables immediately.
 *   - Arrow keys MOVE the selection directly — selection follows the cursor, no
 *     separate Space-to-commit step.
 *   - The list does NOT consume Return: Enter falls through to the surface's
 *     default action (Rewind), which keeps its ring the whole time
 *     (`persistentDefaultRing`).
 *
 * Reuses at0097's deterministic 3-turn `driveDevSession` setup (no live claude).
 * The keystrokes are dispatched as real `keydown` events on the focused element
 * (at0141's pattern): they travel the SAME document-capture pipeline a hardware
 * key does — the engine's act dispatch, the list's arrow handler, and the
 * bubble-stage default-button activation all run for real.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0142-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const SHEET = '[data-slot="tug-sheet"]';
const USER_ROWS = `${CARD} [data-testid="dev-card-transcript-user-body"]`;
const LIST = `${SHEET} [data-slot="tug-list-view"]`;
const REWIND_APPLY = `${SHEET} [data-testid="rewind-apply"]`;

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

/** Drive one committed turn carrying the `/rewind` anchor `uuid-<i>`. */
async function buildTurn(app: App, i: number): Promise<void> {
  const uuid = `uuid-${i}`;
  const msgId = `m-${i}`;
  const frame = (decoded: Record<string, unknown>) =>
    app.driveDevSession("A", {
      op: "ingestFrame",
      feedId: FEED_CODE_OUTPUT,
      decoded: { tug_session_id: SID, ...decoded },
    });
  await app.driveDevSession("A", { op: "send", text: `prompt ${i}` });
  await frame({ type: "prompt_anchor", promptUuid: uuid });
  await frame({ type: "content_block_start", msg_id: msgId, block_index: 0, kind: "text" });
  await frame({ type: "assistant_text", msg_id: msgId, block_index: 0, text: `reply ${i}`, is_partial: false });
  await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
}

// Dispatch a real `keydown` on the focused element — travels the document
// capture pipeline exactly as a hardware key would (at0141's pattern).
function pressKey(app: App, key: string): Promise<null> {
  return app.evalJS<null>(
    `(function(){
      var el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
      return null;
    })()`,
  );
}

/** The `data-prompt-uuid` of the row currently marked selected, or null. */
const SELECTED_UUID = `(function(){
  var row = document.querySelector(${JSON.stringify(`${SHEET} [data-prompt-uuid][data-selected="true"]`)});
  return row ? row.getAttribute("data-prompt-uuid") : null;
})()`;

describe.skipIf(!SHOULD_RUN)(
  "AT0142: single-select list keyboard model — arrows select, Enter falls to the default",
  () => {
    test(
      "list is the key view on open, first row auto-selects, arrows move selection, Enter fires the default action",
      async () => {
        const app = await launchTugApp({ testName: "at0142-single-select-keyboard" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindDevSession("A", { tugSessionId: SID });
          await app.awaitEngineReady("A");

          // Build a 3-turn anchored transcript (valid rewind targets: 2 + 3).
          await buildTurn(app, 1);
          await buildTurn(app, 2);
          await buildTurn(app, 3);
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 3`,
            { timeoutMs: 8000 },
          );

          // Open /rewind via the real submit path.
          await app.nativeClickAtElement(PROMPT_INPUT);
          await app.nativeType("/rewind");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Escape");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Return", ["cmd"]);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SHEET)}) !== null`,
            { timeoutMs: 6000 },
          );

          // On open the LIST holds the keyboard key view (the ring rests on the
          // list, not the OK/Rewind button) — the single-select picker seeds the
          // list, not the default button.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`${LIST}[data-key-view-kbd]`)}) !== null`,
            { timeoutMs: 4000 },
          );

          // The first valid turn (uuid-2) auto-selects on open (`seedSelection`),
          // which enables Rewind (the default action) so its persistent ring shows.
          await app.waitForCondition<boolean>(
            `(function(){
               var b = document.querySelector(${JSON.stringify(REWIND_APPLY)});
               return b !== null && !b.disabled;
             })()`,
            { timeoutMs: 4000 },
          );
          expect(await app.evalJS<string | null>(SELECTED_UUID)).toBe("uuid-2");

          // ArrowDown moves the SELECTION directly — selection follows the cursor,
          // no Space step. (uuid-2 → uuid-3, the second/last valid target.)
          await pressKey(app, "ArrowDown");
          await app.waitForCondition<boolean>(
            `(function(){
               var row = document.querySelector(${JSON.stringify(`${SHEET} [data-prompt-uuid][data-selected="true"]`)});
               return row !== null && row.getAttribute("data-prompt-uuid") === "uuid-3";
             })()`,
            { timeoutMs: 4000 },
          );
          expect(await app.evalJS<string | null>(SELECTED_UUID)).toBe("uuid-3");

          // Enter on the focused list does NOT act on a row — it falls through to
          // the default action (Rewind). The sheet sends `session_rewind`; inject
          // the ack so the local truncation runs and assert turn 3 dropped.
          await pressKey(app, "Enter");
          await app.driveDevSession("A", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: {
              type: "rewind_result",
              tug_session_id: SID,
              promptUuid: "uuid-3",
              scope: "conversation",
              canRewind: true,
            },
          });

          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 2`,
            { timeoutMs: 6000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SHEET)}) === null`,
            { timeoutMs: 4000 },
          );
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length`,
            ),
          ).toBe(2);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
