/**
 * at0220-settings-chips-turn-lock.test.ts — the Z4B AI control locks while an
 * assistant turn is in flight ([AT0220]).
 *
 * ## Why this exists
 *
 * A Mode / Model / Effort change must never race a running turn: mode and
 * model are forwarded to the live `claude` process as control-requests, and
 * an effort change respawns the session process outright ([R07]). Changing
 * any of them mid-turn would reach into (or tear down) the in-flight turn. The
 * fix is a single-source gate: the session lifecycle publishes `canSubmit`
 * (idle/errored + online — the state in which the submit button is a live blue
 * arrow), and every control that reaches `setMode` / `setModel` / `setEffort`
 * is a delegate that acts only when it is set. The setter seam declines the
 * mutation; the chips render `disabled` so the refusal is visible.
 *
 * This drives the **live render + store**:
 *
 *   1. Idle: the AI chip is an enabled `<button>`.
 *   2. A turn goes in flight (`send`): it goes `disabled`.
 *   3. Seam: `⌃⌥⌘P` mid-turn is declined — the permission mode does not change
 *      (the guard runs synchronously in the keydown handler).
 *   4. The turn completes (`turn_complete`): the chip re-enables.
 *   5. With the lock lifted, `⌃⌥⌘P` cycles the mode again — proving step 3's
 *      block was the turn-lock, not a dead key.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 * @covers tugdeck/src/components/tugways/cards/ai-chip.tsx
 * @covers tugdeck/src/lib/session-lifecycle.ts
 * @covers tugdeck/src/lib/model-label.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const SID = "test-session-A"; // bindSession's synthetic tug_session_id

const CARD = '[data-card-id="A"]';
// One chip now carries all three settings, so one gate locks all three.
const AI_CHIP = `${CARD} [data-slot="ai-chip"]`;
// The chip's value line, so `textContent` is the composite alone. Mode is
// its last token.
const AI_VALUE = `${AI_CHIP} [data-slot="ai-chip-value"]`;
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;

// A completed assistant turn: one non-partial assistant message + the
// `turn_complete` that returns the store to `idle` (mirrors at0191).
const asstText = (msgId: string, text: string) => ({
  type: "assistant_text",
  tug_session_id: SID,
  msg_id: msgId,
  text,
  is_partial: false,
  rev: 0,
  seq: 0,
});
const turnDone = (msgId: string) => ({
  type: "turn_complete",
  tug_session_id: SID,
  msg_id: msgId,
  result: "success",
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
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

/** Trimmed text of the mode chip's value line. `null` if absent. */
/** The mode the chip shows — the last token of its composite value. */
async function modeLabel(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(AI_VALUE)});
      if (el === null) return null;
      var parts = el.textContent.trim().split(" \\u00b7 ");
      return parts[parts.length - 1];
    })()`,
  );
}

const PRESS_CYCLE = `document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP", key: "p", metaKey: true, ctrlKey: true, altKey: true, bubbles: true, cancelable: true }))`;

describe.skipIf(!SHOULD_RUN)(
  "AT0220: Z4B Mode/Model/Effort controls lock during an in-flight turn",
  () => {
    test(
      "chips disable while a turn is in flight and re-enable when it completes",
      async () => {
        const app = await launchTugApp({
          testName: "at0220-settings-chips-turn-lock",
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindSession("A");
          await app.awaitEngineReady("A");

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(AI_CHIP)}) !== null`,
            { timeoutMs: 8000 },
          );

          // Make the session card the key card so ⌃⌥⌘P routes to its card-content
          // responder (the same focus step at0088 uses).
          await app.nativeClickAtElement(PROMPT_INPUT);

          // 1. Idle: the AI chip is a live, enabled button.
          expect(
            (await app.getElementState(AI_CHIP)).disabled,
            "AI chip is enabled at idle",
          ).toBe(false);

          const modeBefore = await modeLabel(app);

          // 2. Start a turn → `canSubmit` is false. The one chip carrying all
          //    three settings locks, so all three lock together.
          await app.driveSession("A", { op: "send", text: "hello" });
          await app.waitForCondition<boolean>(
            `window.__tug.getElementState(${JSON.stringify(AI_CHIP)}).disabled === true`,
            { timeoutMs: 4000 },
          );

          // 3. Seam: ⌃⌥⌘P mid-turn is declined by the setter guard — the mode
          //    does not change. The guard is synchronous in the keydown
          //    handler, so a single round-trip settles the outcome.
          await app.evalJS<void>(PRESS_CYCLE);
          expect(
            await modeLabel(app),
            "⌃⌥⌘P must not change the mode while a turn is in flight",
          ).toBe(modeBefore);

          // 4. Complete the turn → the chip re-enables.
          await app.driveSession("A", {
            op: "ingestFrame",
            feedId: CODE_OUTPUT_FEED,
            decoded: asstText("m1", "ok"),
          });
          await app.driveSession("A", {
            op: "ingestFrame",
            feedId: CODE_OUTPUT_FEED,
            decoded: turnDone("m1"),
          });
          await app.waitForCondition<boolean>(
            `window.__tug.getElementState(${JSON.stringify(AI_CHIP)}).disabled === false`,
            { timeoutMs: 4000 },
          );

          // 5. Lock lifted: ⌃⌥⌘P cycles the mode again, proving step 3's block
          //    was the turn-lock and not a dead key.
          await app.nativeClickAtElement(PROMPT_INPUT);
          await app.evalJS<void>(PRESS_CYCLE);
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(AI_VALUE)});
              if (el === null) return false;
              var parts = el.textContent.trim().split(" \\u00b7 ");
              return parts[parts.length - 1] !== ${JSON.stringify(modeBefore)};
            })()`,
            { timeoutMs: 4000 },
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0220-settings-chips-turn-lock] log tail:\n${tail}\n`,
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
