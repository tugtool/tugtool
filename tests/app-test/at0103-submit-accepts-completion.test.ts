/**
 * at0103-submit-accepts-completion.test.ts — submitting while the completion
 * popup is open commits the HIGHLIGHTED completion, not the typed fragment.
 *
 * When the user has typed a trigger fragment (`/re`) and the completion popup
 * is showing a highlighted suggestion (`rewind`), a submit via the Z5 button
 * (or Shift+Return) must send the *completed* command (`/rewind`), not the raw
 * fragment (`/re`, which round-trips to claude as "Unknown command"). Plain
 * Enter / Tab already accept via the completion keymap; the button and
 * Shift+Return bypass it, so `performSubmit` now accepts the active completion
 * first (`TugTextEditorDelegate.acceptActiveCompletion`). The rule is uniform
 * for `/` commands and `@` mentions (same completion engine).
 *
 * Here: a bound session with two anchored turns (so `/rewind` is a valid local
 * command). Type `/rew` (popup shows `rewind` highlighted), click the submit
 * button → the `/rewind` sheet opens and NO transcript row is sent.
 *
 * Has teeth: before the fix the button submitted `/rew`, which is not a
 * registered command — it falls through to `send()`, adding a transcript row
 * and opening no sheet.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0103-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const SUBMIT_BTN = `${CARD} .tug-prompt-entry-submit-button`;
const COMPLETION_MENU = '[data-slot="tug-completion-menu"]';
const SHEET = '[data-slot="tug-sheet"]';
const SHEET_TITLE = `${SHEET} .tug-sheet-title`;
const USER_ROWS = `${CARD} [data-testid="dev-card-transcript-user-body"]`;

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

async function buildTurn(app: App, i: number): Promise<void> {
  const msgId = `m-${i}`;
  const frame = (decoded: Record<string, unknown>) =>
    app.driveDevSession("A", {
      op: "ingestFrame",
      feedId: FEED_CODE_OUTPUT,
      decoded: { tug_session_id: SID, ...decoded },
    });
  await app.driveDevSession("A", { op: "send", text: `prompt ${i}` });
  await frame({ type: "prompt_anchor", promptUuid: `uuid-${i}` });
  await frame({ type: "content_block_start", msg_id: msgId, block_index: 0, kind: "text" });
  await frame({ type: "assistant_text", msg_id: msgId, block_index: 0, text: `reply ${i}`, is_partial: false });
  await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
}

describe.skipIf(!SHOULD_RUN)("AT0103: submit accepts the highlighted completion", () => {
  test(
    "typing /rew and pressing the submit button opens the /rewind sheet (not a sent /rew)",
    async () => {
      const app = await launchTugApp({ testName: "at0103-submit-accepts-completion" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        // Two anchored turns so `/rewind` is a valid (offered) local command.
        await buildTurn(app, 1);
        await buildTurn(app, 2);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 2`,
          { timeoutMs: 8000 },
        );

        // Type the fragment `/rew` — the completion popup opens with `rewind`
        // highlighted (only local command matching "rew"). Do NOT accept it
        // from the keyboard; leave the popup open.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/rew");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(COMPLETION_MENU)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Submit via the Z5 button (the user's primary case). It must accept
        // the highlighted completion first, committing `/rewind`.
        await app.nativeClickAtElement(SUBMIT_BTN);

        // The `/rewind` sheet opens …
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET)}) !== null`,
          { timeoutMs: 6000 },
        );
        const title = await app.evalJS<string | null>(
          `(function(){ var e = document.querySelector(${JSON.stringify(SHEET_TITLE)}); return e ? e.textContent : null; })()`,
        );
        expect(title).toBe("Rewind");

        // … and `/rew` was NOT sent to claude (no new transcript row).
        const rows = await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length`,
        );
        expect(rows).toBe(2);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
