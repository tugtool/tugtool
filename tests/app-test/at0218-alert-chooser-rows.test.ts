/**
 * at0218-alert-chooser-rows.test.ts — TugAlert's multi-action `choose()` form
 * renders rich rows as a SELECTABLE LIST plus an OK / Cancel action bar.
 *
 * The empty-deck "What's next?" chooser (TugCreateDevCard) is a `choose()` call
 * with per-choice icon + description. This drives the same form through the
 * gallery ("Preview What's Next"), which the real modal mirrors, and pins the
 * select-then-commit model:
 *   - the choices render as a vertical stack of `.tug-alert-choice` rows in the
 *     order they were passed (Create Dev Card, then Open Text Card);
 *   - the LIST holds the key-view ring on open (the default row highlighted +
 *     under the cursor), while OK wears the persistent default ring (Return's
 *     home) — the ring is on the list, but Return still commits via OK;
 *   - an arrow roves the highlight live; a click only moves the highlight —
 *     neither resolves the chooser;
 *   - Return (→ OK) commits the highlighted row;
 *   - Cancel sits immediately to the left of OK (both right-aligned).
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
const ACTIONS = `${ALERT} .tug-alert-actions`;
const RESULT = `${CARD} [data-testid="whats-next-result"]`;

// The ordered title text of each rendered chooser row.
const rowTitles = `(function(){
  return Array.from(document.querySelectorAll(${JSON.stringify(`${ROWS} .tug-list-row-title`)}))
    .map(function(el){ return (el.textContent || "").trim(); });
})()`;

// The title of the currently-highlighted (selected) row, or "" if none.
const selectedTitle = `(function(){
  var row = document.querySelector(${JSON.stringify(`${ROWS} .tug-list-row[data-selected="true"]`)});
  if (!row) return "";
  var t = row.querySelector(".tug-list-row-title");
  return (t && t.textContent || "").trim();
})()`;

// An action-bar button by its label text.
const actionButton = (label: string) => `(function(){
  var btns = Array.from(document.querySelectorAll(${JSON.stringify(`${ACTIONS} [data-slot="tug-push-button"]`)}));
  return btns.find(function(b){ return (b.textContent || "").trim() === ${JSON.stringify(label)}; }) || null;
})()`;

// Whether the row LIST holds the key-view ring (keyboard focus lands there).
const listRinged = `(function(){
  var list = document.querySelector(${JSON.stringify(CHOICES)});
  return list !== null && list.hasAttribute("data-key-view");
})()`;

// Whether OK wears the persistent default ring (Return's home) while the ring
// itself sits on the list.
const okDefaultRing = `(function(){
  var ok = ${actionButton("OK")};
  return ok !== null && ok.hasAttribute("data-default-ring");
})()`;

// "Cancel|OK layout": Cancel must sit immediately LEFT of OK, and both are
// right-aligned — so Cancel's left edge is in the alert's right half.
const cancelAdjacentRightOfOk = `(function(){
  var cancel = ${actionButton("Cancel")};
  var ok = ${actionButton("OK")};
  var alert = document.querySelector(${JSON.stringify(ALERT)});
  if (!cancel || !ok || !alert) return "missing";
  var c = cancel.getBoundingClientRect();
  var o = ok.getBoundingClientRect();
  var a = alert.getBoundingClientRect();
  if (c.left >= o.left) return "ok-left-of-cancel";
  if (c.left < a.left + a.width / 2) return "cancel-far-left";
  return "cancel-adjacent-right";
})()`;

describe.skipIf(!SHOULD_RUN)("AT0218: TugAlert choose() is a selectable list + OK/Cancel bar", () => {
  test(
    "rows render in order, default highlights on open, OK rings, click selects (no resolve), Return commits",
    async () => {
      const app = await launchTugApp({ testName: "at0218-alert-chooser-rows" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({
          state: {
            cards: [{ id: "A", componentId: "gallery-alert", title: "Alert Gallery", closable: true }],
            panes: [
              {
                id: "p1",
                position: { x: 40, y: 40 },
                size: { width: 640, height: 560 },
                cardIds: ["A"],
                activeCardId: "A",
                title: "",
                acceptsFamilies: ["maker"],
              },
            ],
            activePaneId: "p1",
            hasFocus: true,
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TRIGGER)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Open the "What's next?" chooser. The preview button sits far down the
        // scrollable gallery card; opening it is not the behavior under test, so
        // trigger it synthetically.
        await app.evalJS(
          `document.querySelector(${JSON.stringify(TRIGGER)}).click()`,
        );
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
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
        ).toEqual(["Create Dev Card", "Open Text Card"]);

        // 2. On open the LIST holds the ring with the default row highlighted;
        //    OK wears the persistent default ring (Return's home).
        await app.waitForCondition<boolean>(
          `${selectedTitle} === "Create Dev Card"`,
          { timeoutMs: 3000 },
        );
        await app.waitForCondition<boolean>(`${listRinged} === true`, { timeoutMs: 3000 });
        await app.waitForCondition<boolean>(`${okDefaultRing} === true`, { timeoutMs: 3000 });

        // 3. Cancel sits immediately left of OK, both right-aligned.
        expect(await app.evalJS<string>(cancelAdjacentRightOfOk)).toBe(
          "cancel-adjacent-right",
        );

        // 4. An arrow roves the highlight live — and does NOT resolve the chooser.
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(
          `${selectedTitle} === "Open Text Card"`,
          { timeoutMs: 3000 },
        );
        expect(
          await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(CHOICES)}) !== null`,
          ),
          "an arrow roves the highlight but must not resolve the chooser",
        ).toBe(true);

        // A real screenshot of the rendered chooser (visual smoke); let the open
        // animation settle first so the capture is crisp.
        await new Promise<void>((r) => setTimeout(r, 400));
        const shot = await app.screenshot();
        console.log(`[at0218] chooser screenshot: ${shot.path}`);

        // 5. Clicking a row ONLY highlights it — the chooser stays open (no resolve).
        await app.evalJS(
          `document.querySelectorAll(${JSON.stringify(ROWS)})[0].click()`,
        );
        await app.waitForCondition<boolean>(
          `${selectedTitle} === "Create Dev Card"`,
          { timeoutMs: 3000 },
        );
        expect(
          await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(CHOICES)}) !== null`,
          ),
          "a row click selects but must not resolve the chooser",
        ).toBe(true);

        // 6. Return (→ OK) commits the highlighted row.
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
