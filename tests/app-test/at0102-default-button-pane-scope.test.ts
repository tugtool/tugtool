/**
 * at0102-default-button-pane-scope.test.ts — a default button registered by a
 * sheet in one pane must NOT be activated by an Enter that originates in
 * another pane ([D15] pane modality, responder-chain.md §"The default button
 * stack").
 *
 * Regression for a cross-pane leak via the GLOBAL default-button stack. An
 * unbound dev card's "Choose Session" picker registers its **Open** button as
 * a default button (`TugPushButton emphasis="filled" role="action"`). The
 * editor keymap's submit-Enter path (and the document Stage-2 path) used to
 * call the *process-global* `peekDefaultButton()` and click whatever was on
 * top — so a submit-Enter typed in pane A's editor pressed pane B's picker
 * Open, spawning a session and dismissing the picker. Both paths now scope the
 * peek to the *originating* pane (`peekDefaultButtonInScope`), so a default
 * button in another pane is unreachable by construction.
 *
 * Setup mirrors the report: pane p1 is a bound dev card (two anchored turns,
 * so `/rewind` has a target); pane p2 is an unbound dev card whose picker is
 * open. We type `/rewind` in p1 and submit with Shift+Enter (which the editor
 * keymap resolves to "submit" on the Code route, exercising the
 * default-button-defer branch — the exact path the stack trace named). The
 * `/rewind` must open p1's rewind sheet and leave p2's picker untouched.
 *
 * Has teeth: before the fix this opened p2's picker Open (p2's picker closed,
 * p1 got no rewind sheet).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;
const SID_A = "at0102-a";
const FEED_CODE_OUTPUT = 0x40;

const PROMPT_A = '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content';
const TITLE_BAR_B = '.tug-pane[data-pane-id="p2"] [data-slot="tug-pane-title-bar"]';
const REWIND_IN_A = '.tug-pane[data-pane-id="p1"] [data-slot="tug-sheet"]';
const PICKER_IN_B = '.tug-pane[data-pane-id="p2"] [data-slot="tug-sheet"]';

let dirA = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  dirA = mkdtempSync(join(tmpdir(), "at0102-a-"));
});
afterAll(() => {
  if (dirA !== "" && existsSync(dirA)) rmSync(dirA, { recursive: true, force: true });
});

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "dev", title: "Dev A", closable: true },
      { id: "B", componentId: "dev", title: "Dev B", closable: true },
    ],
    panes: [
      { id: "p1", position: { x: 40, y: 40 }, size: { width: 760, height: 620 }, cardIds: ["A"], activeCardId: "A", title: "", acceptsFamilies: ["developer"] },
      { id: "p2", position: { x: 840, y: 40 }, size: { width: 760, height: 620 }, cardIds: ["B"], activeCardId: "B", title: "", acceptsFamilies: ["developer"] },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)(
  "AT0102: a default button is pane-scoped — never activated by an Enter from another pane",
  () => {
    test(
      "Shift+Enter in pane A's editor opens A's rewind sheet and does not press pane B's picker Open",
      async () => {
        const app = await launchTugApp({ testName: "at0102-default-button-pane-scope" });
        try {
          await app.enableDeckTrace(true);
          // Start focused on A so A's body (and its submit button, itself a
          // default button) registers FIRST — then B's picker Open lands on
          // TOP of the global default-button stack. That ordering is what
          // makes the bug reproducible: a global peek returns B's Open.
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );

          // Bind A with two anchored turns so `/rewind` has a target. B stays
          // unbound (its picker is the cross-pane default-button source).
          await app.bindDevSession("A", { tugSessionId: SID_A, projectDir: dirA });
          await app.awaitEngineReady("A");
          const drive = async (uuid: string, msgId: string, text: string) => {
            await app.driveDevSession("A", { op: "send", text });
            const frame = (d: Record<string, unknown>) =>
              app.driveDevSession("A", { op: "ingestFrame", feedId: FEED_CODE_OUTPUT, decoded: { tug_session_id: SID_A, ...d } });
            await frame({ type: "prompt_anchor", promptUuid: uuid });
            await frame({ type: "content_block_start", msg_id: msgId, block_index: 0, kind: "text" });
            await frame({ type: "assistant_text", msg_id: msgId, block_index: 0, text: "ok", is_partial: false });
            await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
          };
          await drive("a-uuid-1", "a-m1", "first A");
          await drive("a-uuid-2", "a-m2", "second A");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(PROMPT_A)}) !== null`,
            { timeoutMs: 8000 },
          );

          // Now activate pane B so its unbound picker PRESENTS — registering
          // its Open button on TOP of the default-button stack (after A's
          // submit button). Clicking B's title bar activates the pane without
          // touching A's transcript.
          await app.nativeClickAtElement(TITLE_BAR_B);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(PICKER_IN_B)}) !== null`,
            { timeoutMs: 8000 },
          );

          // Type `/rewind` in pane A's editor and submit with Shift+Enter. The
          // editor keymap resolves Shift+Enter to "submit" on the Code route,
          // taking the default-button-defer branch — the path that used to
          // press pane B's picker Open via the global stack.
          await app.nativeClickAtElement(PROMPT_A);
          await app.nativeType("/rewind");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Escape"); // dismiss the slash-completion popup
          await new Promise((r) => setTimeout(r, 150));
          await app.nativeKey("Enter", ["shift"]);

          // A's rewind sheet opens in pane p1 …
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(REWIND_IN_A)}) !== null`,
            { timeoutMs: 6000 },
          );
          await new Promise((r) => setTimeout(r, 400));

          const where = await app.evalJS<{ rewindInA: boolean; pickerInB: boolean }>(
            `({
               rewindInA: document.querySelector(${JSON.stringify(REWIND_IN_A)}) !== null,
               pickerInB: document.querySelector(${JSON.stringify(PICKER_IN_B)}) !== null,
             })`,
          );
          expect(where.rewindInA).toBe(true); // A's own command ran in A
          expect(where.pickerInB).toBe(true); // B's picker was NOT pressed/dismissed
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
