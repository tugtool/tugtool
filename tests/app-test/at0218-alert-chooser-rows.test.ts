/**
 * at0218-alert-chooser-rows.test.ts — TugAlert's multi-action `choose()` form
 * renders rich rows (icon + title + description) in a closed arrow ring.
 *
 * The empty-deck "What's next?" chooser (TugCreateDevCard) is a `choose()` call
 * with per-choice icon + description. This drives the same form through the
 * gallery ("Preview What's Next"), which the real modal mirrors, and pins:
 *   - the choices render as a vertical stack of `.tug-alert-choice` rows in the
 *     order they were passed (Create Dev Card, then Open Text File);
 *   - the default row (Create Dev Card) holds the key-view ring on open;
 *   - an arrow roves the closed ring across the rows and Cancel and wraps;
 *   - Return on the ringed default row resolves that choice (result "dev").
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-card-id="A"]';
const ALERT = '[data-slot="tug-alert"]';
const TRIGGER = `${CARD} [data-testid="gallery-preview-whats-next"]`;
const CHOICES = `${ALERT} .tug-alert-choices`;
const ROWS = `${CHOICES} .tug-alert-choice`;
const CANCEL = `${ALERT} .tug-alert-actions [data-slot="tug-push-button"]`;
const RESULT = `${CARD} [data-testid="whats-next-result"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-alert", title: "Alert Gallery", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 640, height: 560 },
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

// The ordered title text of each rendered chooser row.
const rowTitles = `(function(){
  return Array.from(document.querySelectorAll(${JSON.stringify(`${ROWS} .tug-list-row-title`)}))
    .map(function(el){ return (el.textContent || "").trim(); });
})()`;

// A row's background-color at rest vs. under the press/active state
// (`data-pressing`), which shares the hover-neutralizing rule. Returns
// "<rest>|<pressed>"; the two halves must match — the row surface must NOT
// swap to a solid role fill on press/hover.
const pressStability = (rowIndex: number) => `(function(){
  var row = document.querySelectorAll(${JSON.stringify(ROWS)})[${rowIndex}];
  if (!row) return "no-row";
  var rest = getComputedStyle(row).backgroundColor;
  row.setAttribute("data-pressing", "true");
  var pressed = getComputedStyle(row).backgroundColor;
  row.removeAttribute("data-pressing");
  return rest + "|" + pressed;
})()`;

// "dev" | "file" | "cancel" | "none" — which control holds the key-view ring.
// Rows are keyed by their title; Cancel by its slot.
const ringed = `(function(){
  var rows = Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}));
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].hasAttribute("data-key-view")) {
      var t = rows[i].querySelector(".tug-list-row-title");
      var label = (t && t.textContent || "").trim();
      if (label === "Create Dev Card") return "dev";
      if (label === "Open Text File") return "file";
      return "row";
    }
  }
  var cancel = document.querySelector(${JSON.stringify(CANCEL)});
  if (cancel && cancel.hasAttribute("data-key-view")) return "cancel";
  return "none";
})()`;

describe.skipIf(!SHOULD_RUN)("AT0218: TugAlert choose() renders rich rows in an arrow ring", () => {
  test(
    "rows render in order, default rings on open, arrow roves the ring, Return resolves the default",
    async () => {
      const app = await launchTugApp({ testName: "at0218-alert-chooser-rows" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TRIGGER)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Open the "What's next?" chooser. The preview button sits far down the
        // scrollable gallery card; opening it is not the behavior under test
        // (the ring/keyboard is), so trigger it synthetically.
        await app.evalJS(
          `document.querySelector(${JSON.stringify(TRIGGER)}).click()`,
        );
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(ALERT)}) !== null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHOICES)}) !== null`,
          { timeoutMs: 6000 },
        );

        // 1. Two rows, in the order they were passed (copy order == UI order).
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(ROWS)}).length === 2`,
          { timeoutMs: 3000 },
        );
        expect(
          await app.evalJS<string[]>(rowTitles),
          "rows render top-to-bottom in passed order",
        ).toEqual(["Create Dev Card", "Open Text File"]);

        // 2. The default row (Create Dev Card) holds the ring on open.
        await app.waitForCondition<boolean>(`${ringed} === "dev"`, { timeoutMs: 3000 });

        // 2b. The row surface stays constant under press/hover — no solid role
        // fill (the bug this guards). Checked on both rows via `data-pressing`,
        // which shares the hover-neutralizing rule.
        for (const i of [0, 1]) {
          const pair = await app.evalJS<string>(pressStability(i));
          const [rest, pressed] = pair.split("|");
          expect(rest, `row ${i} background must be a real surface`).not.toBe("");
          expect(
            pressed,
            `row ${i} must not swap to a role fill under press/hover`,
          ).toBe(rest);
        }

        // A real screenshot of the rendered chooser (visual smoke); let the
        // open animation settle first so the capture is crisp.
        await new Promise<void>((r) => setTimeout(r, 400));
        const shot = await app.screenshot();
        console.log(`[at0218] chooser screenshot: ${shot.path}`);

        // 3. An arrow roves the closed ring: dev → file → cancel → (wrap) dev.
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${ringed} === "file"`, { timeoutMs: 3000 });
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${ringed} === "cancel"`, { timeoutMs: 3000 });
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${ringed} === "dev"`, { timeoutMs: 3000 });

        // 4. Return on the ringed default row resolves that choice.
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHOICES)}) === null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(RESULT)});
            return el !== null && (el.textContent || "").indexOf("dev") !== -1;
          })()`,
          { timeoutMs: 3000 },
        );
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0218] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
