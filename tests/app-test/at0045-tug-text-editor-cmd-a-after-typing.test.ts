/**
 * at0045-tug-text-editor-cmd-a-after-typing.test.ts — bug #1 from manual
 * checkpoint of Step 9.5B: "after typing something, Cmd+A doesn't
 * select all". Confirm empirically whether the responder chain → CM6
 * selectAll path is broken after a typing transaction.
 *
 * (File renamed from the earlier pasteboard-custom-mime probe; the
 * findings from that probe are baked into the redesign described in
 * `clipboard-filters.ts`.)
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;
const TUG_EDIT_CONTENT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-text-editor", title: "TugTextEditor A", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 540 },
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

async function setupGallery(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {},
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.awaitEngineReady("A");
  const editorSelector = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;
  await app.nativeClickAtElement(editorSelector);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelector)})`,
    { timeoutMs: 2000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "m45: Cmd+A after typing — bug #1 reproduction",
  () => {
    test(
      "type 'abc' via nativeType, then ⌘A — selection should cover 0..3",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m45-cmd-a-after-typing",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            // 'a', 'b', 'c' are the three letters confirmed by m44's
            // probe to reliably round-trip through `nativeType` /
            // `nativeKey` against the m44-tested gallery card. Letters
            // outside that subset have proven flaky under harness key
            // delivery — orthogonal issue tracked separately.
            await app.nativeType("abc");
            await new Promise((r) => setTimeout(r, 200));
            const beforeSelectAll = await app.evalJS<{ text: string; sel: unknown }>(
              `(function(){
                var s = window.__tug.getEmCardState("A");
                return { text: s ? s.text : "", sel: s ? s.engineSelection : null };
              })()`,
            );
            console.log("[m45 before-select-all]", JSON.stringify(beforeSelectAll));
            expect(beforeSelectAll.text).toBe("abc");

            await app.nativeKey("a", ["cmd"]);
            await new Promise((r) => setTimeout(r, 200));
            const afterSelectAll = await app.evalJS<{ text: string; sel: unknown }>(
              `(function(){
                var s = window.__tug.getEmCardState("A");
                return { text: s ? s.text : "", sel: s ? s.engineSelection : null };
              })()`,
            );
            console.log("[m45 after-select-all]", JSON.stringify(afterSelectAll));
            expect(afterSelectAll.sel).toEqual({ start: 0, end: 3 });
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
