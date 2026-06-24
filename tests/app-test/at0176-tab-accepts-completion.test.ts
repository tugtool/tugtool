/**
 * at0176-tab-accepts-completion.test.ts — Tab is owned by the app focus walk,
 * but a text editor with an open completion popup keeps Tab to accept the
 * highlighted suggestion.
 *
 * The document-level focus-walk stage intercepts Tab in the capture phase
 * ahead of everything else. Its editor-precedence rule ([Q02], flag model):
 * a focused, editable multi-line editor advertises `data-tug-tab-consume="true"`
 * on its contentDOM (driven by focus, not popup state — `cc0ed15d1`), and the
 * focus walk yields Tab to the editor's own keymap instead of advancing the
 * key view. With a completion open that keymap accepts the suggestion; with no
 * completion a plain Tab indents. Either way Tab stays in the editor.
 *
 * Here: a bound dev session with two anchored turns (so `/rewind` is an offered
 * local command). Type `/rew` → the popup opens and the consume marker appears.
 * Press Tab → the completion is accepted (the `/rew` fragment commits as an
 * atom), the popup closes, focus stays on the editor, and — because the marker
 * tracks focus — the marker stays present.
 *
 * Has teeth: if the focus-walk stage swallowed Tab instead of yielding, the
 * popup would not close, the completion would not be accepted (text stays
 * `/rew`), and focus could leave the editor (clearing the marker).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import type { App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0176-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const COMPLETION_MENU = '[data-slot="tug-completion-menu"]';
const TAB_CONSUME = `${CARD} [data-slot="tug-text-editor"] [data-tug-tab-consume="true"]`;
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

describe.skipIf(!SHOULD_RUN)("AT0176: Tab accepts an open completion (editor keeps Tab)", () => {
  test(
    "typing /rew then pressing Tab accepts /rewind and keeps focus in the editor",
    async () => {
      const app = await launchTugApp({ testName: "at0176-tab-accepts-completion" });
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

        // Type `/rew` — the popup opens with `rewind` highlighted.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/rew");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(COMPLETION_MENU)}) !== null`,
          { timeoutMs: 6000 },
        );

        // The editor advertises that it is consuming Tab while the popup is
        // interactive — the signal the focus walk reads to yield Tab.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TAB_CONSUME)}) !== null`,
          { timeoutMs: 4000 },
        );

        // Press Tab. The focus walk yields to the editor, which accepts the
        // completion: the typed `/rew` fragment commits as a command atom
        // widget, and — crucially — DOM focus stays in the editor. Had the
        // focus walk swallowed Tab instead, the fragment would remain `/rew`
        // and/or focus would leave the editor.
        //
        // The marker is driven by editor *focus*, not popup state ([Q02] flag
        // model, `cc0ed15d1`): a focused multi-line editor owns Tab for
        // indentation, so the marker stays present as long as focus stays —
        // which it does here. Asserting the marker survives is part of the
        // teeth: it proves focus never left the editor.
        await app.nativeKey("Tab");
        // Accept signal: the `/rew` query fragment is replaced by the
        // committed command atom (an `img[data-atom-label]` widget). We
        // wait on the doc, not on the menu: accepting `/rewind` — a
        // command that takes a turn argument — immediately opens its
        // *argument* completion, so `tug-completion-menu` transitions to
        // a new session rather than going null. The fragment being gone
        // and an atom present is the unambiguous proof Tab reached the
        // editor's completion keymap.
        await app.waitForCondition<boolean>(
          `(function(){
            var e = document.querySelector(${JSON.stringify(PROMPT_INPUT)});
            if (e === null) return false;
            return e.textContent.indexOf("/rew") === -1
              && e.querySelector("img[data-atom-label]") !== null;
          })()`,
          { timeoutMs: 6000 },
        );
        const fragmentGone = await app.evalJS<boolean>(
          `(function(){ var e = document.querySelector(${JSON.stringify(PROMPT_INPUT)}); return e !== null && e.textContent.indexOf("/rew") === -1; })()`,
        );
        expect(fragmentGone).toBe(true);
        const focusInEditor = await app.evalJS<boolean>(
          `(function(){ var c = document.querySelector(${JSON.stringify(PROMPT_INPUT)}); return c !== null && c.contains(document.activeElement); })()`,
        );
        expect(focusInEditor).toBe(true);
        // Focus stayed in the editor, so the focus-driven tab-consume marker
        // is still advertised. (A regression that blurred the editor on
        // accept would clear it.)
        const markerStillPresent = await app.evalJS<boolean>(
          `document.querySelector(${JSON.stringify(TAB_CONSUME)}) !== null`,
        );
        expect(markerStillPresent).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
