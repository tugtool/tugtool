/**
 * at0046-tug-edit-first-responder-after-button-click.test.ts —
 * regression test for the user-reported bug from Step 9.5B's manual
 * checkpoint: clicking an atom-row button in the gallery card stole
 * first responder from the editor, so subsequent ⌘A / ⌘C / ⌘X / ⌘V
 * stopped reaching the editor's handlers even though the editor
 * still LOOKED focused (caret blinking, focus-style applied).
 *
 * ## Root cause (recorded for future readers)
 *
 *   `pane-focus-controller` installs a document-level pointerdown
 *   listener that calls `store.activateCard(pane.activeCardId)` for
 *   every click inside a pane. It honored `data-no-activate` (close
 *   button opt-out) but not `data-tug-focus="refuse"` (the attribute
 *   the responder-chain provider already uses to skip first-responder
 *   promotion for focus-refusing controls). `activateCard` calls
 *   `cardLifecycle.setResponderChainKey(cardId)`. That helper had an
 *   idempotency guard (`if (manager.getKeyCard() === cardId) return`)
 *   intended to short-circuit when the card was already active —
 *   except `getKeyCard()` walks for a node tagged `kind: "card"`,
 *   which is set on the pane stack, NOT the card-host. The
 *   comparison never matched cardId and the guard never fired, so
 *   `makeFirstResponder(cardId)` always ran and demoted any inner
 *   responder (e.g. a TugEdit inside the card).
 *
 * ## Two-pronged fix
 *
 *   1. `pane-focus-controller`: extended the skip list to also skip
 *      when `target.closest('[data-tug-focus="refuse"]')`. Aligns
 *      with the chain provider's existing handling.
 *   2. `card-lifecycle.setResponderChainKey`: replaced the broken
 *      `getKeyCard() === cardId` check with
 *      `manager.firstResponderIsAtOrBelow(cardId)`, a new chain
 *      method that walks parentId from the first responder and
 *      matches both id-equals and id-as-ancestor. Closes the broken-
 *      guard hole so the helper is genuinely idempotent for "promote
 *      a card whose subtree already contains the first responder".
 *
 * Either fix alone resolves the user-reported symptom; both together
 * are defense in depth.
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

const TUG_EDIT_CONTENT_SELECTOR = '[data-slot="tug-edit"] .cm-content';
const GALLERY_FILE_ATOM_BUTTON_SELECTOR =
  '[data-card-id="A"] .gallery-text-edit-atom-row [data-slot="tug-push-button"]:nth-of-type(1)';

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-text-edit", title: "TugEdit A", closable: true },
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

interface DocProbe {
  text: string;
  sel: { start: number; end: number } | null;
  firstResponderTag: string;
}

async function probe(app: App): Promise<DocProbe> {
  return app.evalJS<DocProbe>(
    `(function(){
      var s = window.__tug.getEmCardState("A");
      var fr = document.querySelector("[data-first-responder]");
      var frTag = "(none)";
      if (fr) {
        var slot = fr.getAttribute("data-slot") || "";
        var rid = fr.getAttribute("data-responder-id") || "";
        frTag = fr.tagName + (slot ? "." + slot : "") + " (id=" + rid + ")";
      }
      return {
        text: s ? s.text : "",
        sel: s ? s.engineSelection : null,
        firstResponderTag: frTag,
      };
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "m46: first-responder survives an atom-button click",
  () => {
    test(
      "click into editor → type → click atom button → ⌘A still selects all",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m46-first-responder-after-button",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            // Type "abc" so we have a doc to select. Confirm the
            // editor is first responder and ⌘A works as a baseline.
            await app.nativeType("abc");
            await new Promise((r) => setTimeout(r, 200));
            await app.nativeKey("a", ["cmd"]);
            await new Promise((r) => setTimeout(r, 200));
            const baseline = await probe(app);
            expect(baseline.sel, "baseline ⌘A: editor is first responder").toEqual({
              start: 0,
              end: 3,
            });
            expect(
              baseline.firstResponderTag,
              "baseline: first responder is the tug-edit host",
            ).toContain("tug-edit");

            // Move caret to end so the upcoming atom insert lands at
            // position 3 (after the text), not over the selection.
            await app.nativeKey("ArrowRight");
            await new Promise((r) => setTimeout(r, 100));

            // Click the atom button. This is the user's suspect
            // operation. The fix(es) keep first responder on the
            // editor:
            //   - pane-focus-controller skips activation when the
            //     click target is `data-tug-focus="refuse"`.
            //   - setResponderChainKey's `firstResponderIsAtOrBelow`
            //     guard short-circuits because the editor is
            //     already in the card's subtree.
            await app.nativeClickAtElement(GALLERY_FILE_ATOM_BUTTON_SELECTOR);
            await new Promise((r) => setTimeout(r, 300));
            const afterClick = await probe(app);
            expect(afterClick.text.length, "atom inserted: doc grew by one U+FFFC").toBe(4);
            expect(
              afterClick.firstResponderTag,
              "after atom-button click: first responder MUST still be the editor",
            ).toContain("tug-edit");

            // ⌘A again — must select the entire (4-char) doc.
            await app.nativeKey("a", ["cmd"]);
            await new Promise((r) => setTimeout(r, 200));
            const afterCmdA = await probe(app);
            expect(
              afterCmdA.sel,
              "post-button-click ⌘A: keyboard commands still reach the editor",
            ).toEqual({ start: 0, end: 4 });
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
