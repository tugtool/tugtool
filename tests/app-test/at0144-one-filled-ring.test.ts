/**
 * at0144-one-filled-ring.test.ts — at most one filled+ring per sheet ([P14]).
 *
 * ## Why this exists
 *
 * A confirm-style picker seeds its LIST as the key view and gives its default
 * button (OK) a persistent "Return's home" ring. The bug: Tab onto Cancel
 * promoted Cancel to filled+ring while OK's persistent ring stayed lit — TWO
 * filled+ring buttons. The fix makes the persistent default ring ENGINE-OWNED:
 * the manager stamps `data-default-ring` on the default button only while the
 * key view is not itself a button, and removes it the instant the keyboard lands
 * on any button. So exactly one control reads filled+ring at any time.
 *
 * Asserted via the engine attributes that DRIVE the filled+ring promotion — a
 * button reads filled+ring iff it carries `data-key-view-kbd` (live) or
 * `data-default-ring` (Return's home):
 *   - open: the list holds the key view; OK carries `data-default-ring`; exactly
 *     one BUTTON wears a filled+ring marker (OK).
 *   - Tab → Cancel: Cancel carries `data-key-view-kbd`, OK's `data-default-ring`
 *     is gone; still exactly one filled+ring button (Cancel).
 *
 * Driven through `/model` (the `KNOWN_MODELS` fallback needs no metadata setup).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0144-session";

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const SHEET = '[data-slot="tug-sheet"]';
const LIST = `${SHEET} [data-slot="tug-list-view"]`;
const OK = `${SHEET} .tug-sheet-actions .tug-button-primary-action`;
const CANCEL = `${SHEET} .tug-sheet-actions .tug-button-outlined-action`;

// Count the BUTTONS that currently read filled+ring — those carrying the live
// key-view marker or the engine-owned persistent default ring.
const FILLED_RING_BUTTONS = `(function(){
  var all = document.querySelectorAll(${JSON.stringify(`${SHEET} .tug-button`)});
  var n = 0;
  for (var i = 0; i < all.length; i++) {
    var b = all[i];
    if (b.hasAttribute("data-key-view-kbd") || b.hasAttribute("data-default-ring")) n++;
  }
  return n;
})()`;

function hasAttr(app: App, selector: string, attr: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el!==null && el.hasAttribute(${JSON.stringify(attr)});})()`,
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

describe.skipIf(!SHOULD_RUN)("AT0144: at most one filled+ring per sheet", () => {
  test(
    "open seeds the list + OK ring; Tab to Cancel moves the sole filled+ring onto Cancel",
    async () => {
      const app = await launchTugApp({ testName: "at0144-one-filled-ring" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        // Open /model via the real submit path.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/model");
        await new Promise((r) => setTimeout(r, 200));
        await app.nativeKey("Escape");
        await new Promise((r) => setTimeout(r, 200));
        await app.nativeKey("Return", ["cmd"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET)}) !== null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });

        // On open: the list holds the key view; OK wears the engine-owned default
        // ring; Cancel wears nothing. Exactly one BUTTON reads filled+ring (OK).
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(LIST)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 4000 },
        );
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(OK)});return el!==null && el.hasAttribute("data-default-ring");})()`,
          { timeoutMs: 4000 },
        );
        expect(await hasAttr(app, CANCEL, "data-default-ring")).toBe(false);
        expect(await hasAttr(app, CANCEL, "data-key-view-kbd")).toBe(false);
        expect(await app.evalJS<number>(FILLED_RING_BUTTONS), "open: only OK is filled+ring").toBe(1);

        // Tab onto Cancel: it becomes the live key view (filled+ring), and the
        // engine stands OK's default ring down — still exactly one filled+ring.
        let onCancel = false;
        for (let i = 0; i < 4 && !onCancel; i += 1) {
          await app.nativeKey("Tab");
          await new Promise((r) => setTimeout(r, 150));
          onCancel = await hasAttr(app, CANCEL, "data-key-view-kbd");
        }
        expect(onCancel, "Tab lands the key view on Cancel").toBe(true);
        expect(
          await hasAttr(app, OK, "data-default-ring"),
          "OK's persistent default ring stands down when Cancel is focused",
        ).toBe(false);
        expect(
          await app.evalJS<number>(FILLED_RING_BUTTONS),
          "after Tab: only Cancel is filled+ring (never two)",
        ).toBe(1);

        process.stdout.write("VERDICT: PASS\n");
      } catch (err) {
        process.stdout.write("VERDICT: FAIL\n");
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0144-one-filled-ring] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
