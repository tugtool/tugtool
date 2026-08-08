/**
 * at0372-ai-config-mixer.test.ts — the AI mixer is a transaction, and its rows
 * are coupled ([AT0372]).
 *
 * ## Why this exists
 *
 * Model, reasoning effort, and permission mode used to be three chips over
 * three confirm-style pickers. They are one chip over one mixer sheet now, and
 * the collapse is only worth having if two properties hold in the real app:
 *
 *   1. **Nothing reaches the wire until OK.** Browsing the rows must not bounce
 *      the claude process — an effort change costs a respawn. So a run of
 *      segment clicks followed by **Cancel** must leave the chip exactly where
 *      it was, and the same run followed by **OK** must land all of it at once.
 *   2. **The rows are coupled in view.** Effort is per-model. Choosing a model
 *      that supports fewer levels greys the missing ones IN PLACE (the row
 *      keeps its shape) and clamps a stranded pending level DOWNWARD rather
 *      than promoting the user to a bigger thinking budget than they asked for.
 *      This is the coupling that used to be discoverable only by crossing two
 *      dialogs.
 *
 * Also pinned: the three deep-link slash commands (`/model`, `/effort`,
 * `/mode`) open the ONE sheet, and `/ai` opens it too — the muscle memory
 * survives the collapse.
 *
 * Capabilities are injected through the `ingestSessionMetadata` surface seam
 * (the chip reads its own `SESSION_METADATA` FeedStore, unreachable by the
 * `driveSession` path); no live claude handshake is needed. The respawn itself
 * is a tugcode concern, covered at that layer.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/cards/ai-chip.tsx
 * @covers tugdeck/src/components/tugways/cards/ai-config-sheet.tsx
 * @covers tugdeck/src/components/tugways/cards/ai-config-sheet.css
 * @covers tugdeck/src/lib/ai-config.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const CHIP = `${CARD} [data-slot="ai-chip"]`;
/** The shown face only — the width-stabilizer's sizers are hidden siblings. */
const CHIP_VALUE = `${CHIP} [data-slot="ai-chip-value"] [data-tug-stable="active"]`;
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;

const SHEET = '[data-slot="ai-config-sheet"]';
const MODEL_ROW = `${SHEET} [data-testid="ai-config-model"]`;
const EFFORT_ROW = `${SHEET} [data-testid="ai-config-effort"]`;
const MODE_ROW = `${SHEET} [data-testid="ai-config-mode"]`;
const SEGMENT = (row: string, value: string): string =>
  `${row} [data-choice-value="${value}"]`;
const OK = `${SHEET} [data-slot="ai-config-ok"]`;
const CANCEL = `${SHEET} [data-slot="ai-config-cancel"]`;

/**
 * Capabilities with two effort shapes: the account default (opus) supports all
 * five levels; sonnet supports four (no `xhigh`); haiku none. Exactly the
 * shape claude's own `initialize` reports.
 */
function capabilities() {
  return {
    type: "session_capabilities",
    models: [
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Opus 5 · Best for everyday, complex tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "sonnet",
        displayName: "Sonnet",
        description: "Sonnet 4.6 · Fast for most tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
      {
        value: "haiku",
        displayName: "Haiku",
        description: "Haiku 4.5 · Fastest",
      },
    ],
    commands: [],
    agents: [],
    available_output_styles: [],
    output_style: "default",
    account: null,
    effort: null,
    ipc_version: 2,
  };
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 560 },
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

/** The chip's whole composite face. */
async function chipValue(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(CHIP_VALUE)});
      return el ? el.textContent.trim() : null;
    })()`,
  );
}

/** The `data-choice-value` of a row's active segment, or null. */
async function activeSegment(app: App, row: string): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(`${row} [data-state="active"]`)});
      return el ? el.getAttribute("data-choice-value") : null;
    })()`,
  );
}

/** The `data-choice-value`s of a row's disabled segments, in DOM order. */
async function disabledSegments(app: App, row: string): Promise<string[]> {
  return await app.evalJS<string[]>(
    `(function(){
      var segs = document.querySelectorAll(${JSON.stringify(`${row} [data-choice-value]`)});
      var out = [];
      for (var i = 0; i < segs.length; i++) {
        if (segs[i].hasAttribute("data-disabled") || segs[i].disabled === true) {
          out.push(segs[i].getAttribute("data-choice-value"));
        }
      }
      return out;
    })()`,
  );
}

const SHEET_OPEN = `document.querySelector(${JSON.stringify(SHEET)}) !== null`;
const SHEET_CLOSED = `document.querySelector(${JSON.stringify(SHEET)}) === null`;

describe.skipIf(!SHOULD_RUN)("AT0372: the AI mixer's transaction and row coupling", () => {
  test(
    "Cancel sends nothing; OK lands the whole diff; the EFFORT row greys and clamps to the pending model",
    async () => {
      const app = await launchTugApp({ testName: "at0372-ai-config-mixer" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A");
        await app.awaitEngineReady("A");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHIP_VALUE)}) !== null`,
          { timeoutMs: 8000 },
        );

        // The account default supports all five levels and no override is set,
        // so the composite is the full triple.
        await app.ingestSessionMetadata("A", capabilities());
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(CHIP_VALUE)});
            return el !== null && el.textContent.trim() === "Opus 5 · High · Default";
          })()`,
          { timeoutMs: 6000 },
        );
        const before = await chipValue(app);

        // ---- 1. Cancel is free ------------------------------------------
        await app.click(CHIP);
        await app.waitForCondition<boolean>(SHEET_OPEN, { timeoutMs: 4000 });

        // Move all three rows, then abandon the transaction.
        await app.click(SEGMENT(MODEL_ROW, "sonnet"));
        await app.click(SEGMENT(EFFORT_ROW, "low"));
        await app.click(SEGMENT(MODE_ROW, "plan"));
        expect(
          await chipValue(app),
          "the chip must not move while the sheet is open",
        ).toBe(before);

        await app.click(CANCEL);
        await app.waitForCondition<boolean>(SHEET_CLOSED, { timeoutMs: 4000 });
        expect(
          await chipValue(app),
          "Cancel commits nothing — three moved rows, zero frames",
        ).toBe(before);

        // ---- 2. The rows are coupled ------------------------------------
        await app.click(CHIP);
        await app.waitForCondition<boolean>(SHEET_OPEN, { timeoutMs: 4000 });

        // Opus supports every level, so nothing is greyed at open time.
        expect(
          await disabledSegments(app, EFFORT_ROW),
          "opus supports all five levels",
        ).toEqual([]);

        // Take the pending effort to a level sonnet does not offer, then pick
        // sonnet: `xhigh` greys, and the pending level clamps DOWN to the
        // nearest supported one rather than being promoted.
        await app.click(SEGMENT(EFFORT_ROW, "xhigh"));
        expect(await activeSegment(app, EFFORT_ROW)).toBe("xhigh");

        await app.click(SEGMENT(MODEL_ROW, "sonnet"));
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(SEGMENT(EFFORT_ROW, "xhigh"))});
            return el !== null && (el.hasAttribute("data-disabled") || el.disabled === true);
          })()`,
          { timeoutMs: 4000 },
        );
        expect(
          await disabledSegments(app, EFFORT_ROW),
          "only the level sonnet lacks greys — the row keeps its shape",
        ).toEqual(["xhigh"]);
        expect(
          await activeSegment(app, EFFORT_ROW),
          "a stranded level clamps DOWN, never up",
        ).toBe("high");

        // ---- 3. OK lands the whole diff at once -------------------------
        await app.click(SEGMENT(MODE_ROW, "plan"));
        await app.click(OK);
        await app.waitForCondition<boolean>(SHEET_CLOSED, { timeoutMs: 4000 });
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(CHIP_VALUE)});
            return el !== null && el.textContent.trim() === "Sonnet 4.6 · High · Plan";
          })()`,
          { timeoutMs: 6000 },
        );

        // ---- 4. A model with no effort at all disables the row whole ----
        await app.click(CHIP);
        await app.waitForCondition<boolean>(SHEET_OPEN, { timeoutMs: 4000 });
        await app.click(SEGMENT(MODEL_ROW, "haiku"));
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(EFFORT_ROW)});
            return el !== null && el.hasAttribute("data-disabled");
          })()`,
          { timeoutMs: 4000 },
        );
        expect(
          await activeSegment(app, EFFORT_ROW),
          "no supported level → no segment paints active (an empty value is inert)",
        ).toBeNull();
        await app.click(CANCEL);
        await app.waitForCondition<boolean>(SHEET_CLOSED, { timeoutMs: 4000 });
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0372-ai-config-mixer] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "/ai and the three attribute names all open the one sheet",
    async () => {
      const app = await launchTugApp({ testName: "at0372-ai-config-deep-links" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A");
        await app.awaitEngineReady("A");
        await app.ingestSessionMetadata("A", capabilities());
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHIP_VALUE)}) !== null`,
          { timeoutMs: 8000 },
        );

        // Every one of the four names opens the SAME sheet — three rows, one
        // OK. The retired `/model` and `/effort` pickers were two more sheets;
        // typing their names now lands here.
        for (const name of ["ai", "model", "effort", "mode"]) {
          await app.nativeClickAtElement(PROMPT_INPUT);
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("run-card-command", { name: ${JSON.stringify(name)} }), null)`,
          );
          await app.waitForCondition<boolean>(SHEET_OPEN, { timeoutMs: 4000 });
          const rows = await app.evalJS<number>(
            `[${JSON.stringify(MODEL_ROW)}, ${JSON.stringify(EFFORT_ROW)}, ${JSON.stringify(MODE_ROW)}]
              .filter(function(s){ return document.querySelector(s) !== null; }).length`,
          );
          expect(rows, `/${name} opens the three-row mixer`).toBe(3);
          await app.click(CANCEL);
          await app.waitForCondition<boolean>(SHEET_CLOSED, { timeoutMs: 4000 });
        }
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0372-ai-config-deep-links] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
