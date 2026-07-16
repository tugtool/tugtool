/**
 * at0195-atom-selected-appearance.test.ts — atom chips swap to their
 * selected-variant bake when the editor's text selection covers them
 * ([AT0195]).
 *
 * ## Scenario
 *
 * The default atom chip paints with a translucent blue surface; the
 * editor's selection overlay is a translucent blue wash painted behind
 * the content. A chip the selection covers used to sit blue-on-blue and
 * stop reading as a distinct unit. `selectedAtomSyncPlugin` fixes this by
 * swapping each covered chip's `<img>` to a bake from the
 * `-selected-rest` chip tokens (saturated surface, lighter glyphs) and
 * marking it `data-selected="true"`; an uncovered chip keeps the resting
 * bake and carries no `data-selected`.
 *
 * Drives a real atom into the editor (type `/rew` → Tab accepts the
 * `/rewind` completion, which commits a command atom widget — the same
 * path at0176 exercises), then:
 *   1. Select all (Cmd-A) → the atom chip gains `data-selected="true"`
 *      and its `src` changes to the selected-variant bake.
 *   2. Collapse the selection (Right arrow) → `data-selected` clears and
 *      the chip's `src` returns to the resting bake.
 *
 * Has teeth: if `selectedAtomSyncPlugin` were absent or mis-detected
 * coverage, the chip would never gain `data-selected` and its `src`
 * would never change under selection.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0195-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const COMPLETION_MENU = '[data-slot="tug-completion-menu"]';
const ATOM_IMG = `${CARD} [data-slot="tug-text-editor"] img[data-atom-type]`;
const USER_ROWS = `${CARD} [data-testid="session-card-transcript-user-body"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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

async function buildTurn(app: App, i: number): Promise<void> {
  const msgId = `m-${i}`;
  const frame = (decoded: Record<string, unknown>) =>
    app.driveSession("A", {
      op: "ingestFrame",
      feedId: FEED_CODE_OUTPUT,
      decoded: { tug_session_id: SID, ...decoded },
    });
  await app.driveSession("A", { op: "send", text: `prompt ${i}` });
  await frame({ type: "prompt_anchor", promptUuid: `uuid-${i}` });
  await frame({ type: "content_block_start", msg_id: msgId, block_index: 0, kind: "text" });
  await frame({ type: "assistant_text", msg_id: msgId, block_index: 0, text: `reply ${i}`, is_partial: false });
  await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
}

/** The atom chip's `data-selected` attribute (`"true"` | `null`). */
function readSelectedScript(): string {
  return `(function(){
    var img = document.querySelector(${JSON.stringify(ATOM_IMG)});
    return img ? img.getAttribute("data-selected") : "no-img";
  })()`;
}

/** The atom chip's current `src`. */
function readSrcScript(): string {
  return `(function(){
    var img = document.querySelector(${JSON.stringify(ATOM_IMG)});
    return img ? img.src : null;
  })()`;
}

describe.skipIf(!SHOULD_RUN)("AT0195: a selection-covered atom chip paints with its selected-variant bake", () => {
  test(
    "Cmd-A marks the chip selected and re-bakes its src; collapsing the selection reverts it",
    async () => {
      const app = await launchTugApp({ testName: "at0195-atom-selected-appearance" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        // Two anchored turns so `/rewind` is a valid (offered) local command.
        await buildTurn(app, 1);
        await buildTurn(app, 2);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 2`,
          { timeoutMs: 8000 },
        );

        // Type `/rew` and accept with Tab → a `/rewind` command atom commits
        // as a widget in the editor.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/rew");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(COMPLETION_MENU)}) !== null`,
          { timeoutMs: 6000 },
        );
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(ATOM_IMG)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Resting: the atom is not covered by any selection.
        await app.waitForCondition<boolean>(
          `(function(){ return ${readSelectedScript()} === null; })()`,
          { timeoutMs: 3000 },
        );
        const restSrc = await app.evalJS<string | null>(readSrcScript());
        expect(restSrc).not.toBeNull();

        // Select all → the selection covers the atom → chip reads selected.
        await app.nativeKey("a", ["cmd"]);
        await app.waitForCondition<boolean>(
          `(function(){ return ${readSelectedScript()} === "true"; })()`,
          { timeoutMs: 3000 },
        );
        const selectedSrc = await app.evalJS<string | null>(readSrcScript());
        expect(selectedSrc).not.toBeNull();
        // The selected bake re-baked colors — not just an attribute toggle.
        expect(selectedSrc).not.toBe(restSrc);

        // Collapse the selection → chip reverts to the resting bake.
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){ return ${readSelectedScript()} === null; })()`,
          { timeoutMs: 3000 },
        );
        const revertedSrc = await app.evalJS<string | null>(readSrcScript());
        expect(revertedSrc).toBe(restSrc);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
