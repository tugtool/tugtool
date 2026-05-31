/**
 * at0101-slash-command-pane-scope.test.ts — a slash command typed into a
 * prompt entry runs on THAT prompt entry's card, never on another pane's
 * card ([D15] pane modality, responder-chain.md §"Dispatching from a
 * control").
 *
 * Regression for a cross-pane dispatch leak. `TugPromptEntry` recognized a
 * local `/command` at submit and routed it through `useKeyCardDispatch`
 * (`sendToKeyCard`) — which derives its target from the GLOBAL first
 * responder. When a pane-modal sheet holds first responder in another pane,
 * the "key card" is THAT pane's card, so `/rewind` typed in pane A ran on
 * pane B: A's command dismissed/replaced B's open sheet and A got nothing.
 *
 * The fix routes the command via `manager.sendToTarget(localCommandTargetId)`
 * — the host (the dev card) hands the prompt entry its own card-content
 * responder id, and the command is delivered there by structural identity,
 * independent of first responder. (A parent-targeted control dispatch can't
 * reach card-content: it's a registry *sibling* of the prompt entry's chain,
 * historically reached only by the key card's DOM-subtree search.) A
 * control/editor emission has a specific receiver (its owner), not
 * "whichever card the user is in"; the latter is for keyboard shortcuts only.
 *
 * The test constructs the documented divergence between DOM focus and chain
 * first responder (responder-chain.md §"Bringing DOM focus in sync"): the
 * keyboard caret sits in pane A's editor (so its submit drives A's
 * `performSubmit`) while the chain first responder is pinned into pane B
 * (via the sanctioned `makeFirstResponder`, exposed for tests as
 * `__tug.setFirstResponder`). Submit is driven by Cmd+Return — a KEYSTROKE
 * the editor keymap owns directly (forced submit, never a document
 * keybinding routed to first responder); a pointer click in pane A would
 * activate the pane and re-promote A, collapsing the divergence. First
 * responder therefore stays in B — exactly the state that made the old code
 * mis-route — and the `/rewind` must still open A's sheet, in pane A's
 * frame, and leave pane B with no sheet. (Verified to have teeth: with the
 * old `sendToKeyCard` routing this opens pane B's sheet instead.)
 *
 * Both cards are live dev sessions with two committed turns each (≥2
 * anchored turns is what makes `/rewind` have a target and open at all).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID_A = "at0101-a";
const SID_B = "at0101-b";
const FEED_CODE_OUTPUT = 0x40;

const PROMPT_A = '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content';
const PROMPT_B = '[data-card-id="B"] [data-slot="tug-text-editor"] .cm-content';
const SHEET_IN_A = '.tug-pane[data-pane-id="p1"] [data-slot="tug-sheet"]';
const SHEET_IN_B = '.tug-pane[data-pane-id="p2"] [data-slot="tug-sheet"]';

let dirA = "";
let dirB = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  dirA = mkdtempSync(join(tmpdir(), "at0101-a-"));
  dirB = mkdtempSync(join(tmpdir(), "at0101-b-"));
});

afterAll(() => {
  for (const d of [dirA, dirB]) {
    if (d !== "" && existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "dev", title: "Dev A", closable: true },
      { id: "B", componentId: "dev", title: "Dev B", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
      {
        id: "p2",
        position: { x: 840, y: 40 },
        size: { width: 760, height: 620 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)(
  "AT0101: a typed slash command is pane-scoped — never routed by the global key card",
  () => {
    test(
      "/rewind submitted in pane A opens A's sheet, even with first responder pinned in pane B",
      async () => {
        const app = await launchTugApp({
          testName: "at0101-slash-command-pane-scope",
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );

          // Two live dev sessions, two committed (anchored) turns each, so
          // `/rewind` has a target and its sheet can open.
          const drive = (
            cardId: string,
            sid: string,
            uuid: string,
            msgId: string,
            text: string,
          ) =>
            (async () => {
              await app.driveDevSession(cardId, { op: "send", text });
              const frame = (decoded: Record<string, unknown>) =>
                app.driveDevSession(cardId, {
                  op: "ingestFrame",
                  feedId: FEED_CODE_OUTPUT,
                  decoded: { tug_session_id: sid, ...decoded },
                });
              await frame({ type: "prompt_anchor", promptUuid: uuid });
              await frame({
                type: "content_block_start",
                msg_id: msgId,
                block_index: 0,
                kind: "text",
              });
              await frame({
                type: "assistant_text",
                msg_id: msgId,
                block_index: 0,
                text: "ok",
                is_partial: false,
              });
              await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
            })();

          await app.bindDevSession("A", { tugSessionId: SID_A, projectDir: dirA });
          await app.awaitEngineReady("A");
          await app.bindDevSession("B", { tugSessionId: SID_B, projectDir: dirB });
          await app.awaitEngineReady("B");

          await drive("A", SID_A, "a-uuid-1", "a-m1", "first A");
          await drive("A", SID_A, "a-uuid-2", "a-m2", "second A");
          await drive("B", SID_B, "b-uuid-1", "b-m1", "first B");
          await drive("B", SID_B, "b-uuid-2", "b-m2", "second B");

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(PROMPT_A)}) !== null`,
            { timeoutMs: 8000 },
          );

          // REALISTIC REPRO: open the rewind sheet in pane B FIRST.
          await app.nativeClickAtElement(PROMPT_B);
          await app.nativeType("/rewind");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Escape");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Enter", ["cmd"]);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SHEET_IN_B)}) !== null`,
            { timeoutMs: 6000 },
          );

          // Now invoke `/rewind` in pane A. Expected: A's sheet opens; B's
          // sheet stays open (pane-modal — A's command must not touch B).
          await app.nativeClickAtElement(PROMPT_A);
          await app.nativeType("/rewind");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Escape");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Enter", ["cmd"]);

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SHEET_IN_A)}) !== null`,
            { timeoutMs: 6000 },
          );
          await new Promise((r) => setTimeout(r, 600));

          const where = await app.evalJS<{ inA: boolean; inB: boolean }>(
            `({
               inA: document.querySelector(${JSON.stringify(SHEET_IN_A)}) !== null,
               inB: document.querySelector(${JSON.stringify(SHEET_IN_B)}) !== null,
             })`,
          );
          console.log("AT0101 SURVIVAL DIAG:", JSON.stringify(where));
          expect(where.inA).toBe(true); // A's sheet opened
          expect(where.inB).toBe(true); // B's sheet SURVIVED (not dismissed)
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
