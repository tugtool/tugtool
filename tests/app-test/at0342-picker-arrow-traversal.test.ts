/**
 * at0342-picker-arrow-traversal.test.ts — the Choose Session sheet answers the
 * arrows as the grid it looks like.
 *
 * Before the sheet declared a spatial order, arrows worked only *inside* the
 * sessions list plus the filter field's bespoke ArrowDown advance: Up from the
 * list's top row went nowhere, and no arrow ever reached Move-all-to-Trash,
 * Cancel, or Open. The sheet now authors a `rowGridOrder` over its stops, so
 * every seam is real and the Cancel/Open pair is a closed horizontal ring.
 *
 * Drives the real sheet, reading the ENGINE key view (`data-key-view-kbd`) on
 * each stop's stable authored focus-key. Keystrokes are synthetic `keydown`s
 * dispatched on the focused element for the same reason at0141 uses them: they
 * travel the identical document-capture pipeline a hardware key does (the
 * spatial navigator's listeners are document-capture), while the sheet scrolls
 * its seeded commit-home into view, which puts a native click off-target.
 *
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 * @covers tugdeck/src/components/tugways/spatial-order.ts
 * @covers tugdeck/src/components/tugways/responder-chain-provider.tsx
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

// Picker stops by their stable authored focus-key (`group:order`) — the same
// attribute the engine lands `data-key-view-kbd` on.
const BROWSE = '[data-tug-focus-key="session-picker-cycle:-0.5"]';
const FILTER = '[data-tug-focus-key="session-picker-cycle:1"]';
const SESSIONS = '[data-tug-focus-key="session-picker-cycle:2"]';
const TRASH = '[data-tug-focus-key="session-picker-cycle:3"]';
const CANCEL = '[data-tug-focus-key="session-picker-cycle:4"]';
const OPEN = '[data-tug-focus-key="session-picker-cycle:5"]';
const PICKER_FORM = ".session-card-picker-form";

// Real directories on the macOS test host, so the path seed leaves Open ENABLED
// and the smart latch lands the ring on the Sessions list.
const SEED_RECENTS = ["/", "/tmp", "/usr"];

function hasKeyView(selector: string): string {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    return el ? el.hasAttribute("data-key-view-kbd") : false;
  })()`;
}

function pressKey(app: { evalJS<T>(s: string): Promise<T> }, key: string): Promise<null> {
  return app.evalJS<null>(
    `(function(){
      var el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
      return null;
    })()`,
  );
}

const PICKER_OPEN = `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 600 },
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

describe.skipIf(!SHOULD_RUN)("at0342 — the Choose Session sheet traverses by arrow", () => {
  test(
    "arrows cross every seam of the sheet's authored grid, and Cancel/Open ring horizontally",
    async () => {
      const app = await launchTugApp({ testName: "at0342-picker-arrow-traversal" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        // An UNBOUND session card presents its picker.
        await app.waitForCondition<boolean>(PICKER_OPEN, { timeoutMs: 8000 });

        await app.evalJS<null>(
          `(window.__tug.setTugbankValue(${JSON.stringify("dev.tugtool.dev")}, ${JSON.stringify("recent-projects")}, { kind: "json", value: { paths: ${JSON.stringify(SEED_RECENTS)} } }), null)`,
        );
        // The seed lands the ring on the Sessions list once the path settles.
        await app.waitForCondition<boolean>(hasKeyView(SESSIONS), { timeoutMs: 8000 });

        // Up off the list's top row crosses the seam to the filter field above
        // it — the traversal that simply did not exist before the sheet declared
        // its order (the list clamped and ate the key).
        await pressKey(app, "ArrowUp");
        await app.waitForCondition<boolean>(hasKeyView(FILTER), { timeoutMs: 3000 });

        // The filter field is empty, so it spends the arrow on movement: Down
        // returns to the list rather than dead-ending on a caret with nothing to
        // move. (A field holding a query keeps its arrows; its own delegate
        // advance covers the non-empty ArrowDown.)
        await pressKey(app, "ArrowDown");
        await app.waitForCondition<boolean>(hasKeyView(SESSIONS), { timeoutMs: 3000 });

        // Down off the list's bottom row continues to the trash control. That
        // control is disabled when the seeded path has nothing to sweep, and a
        // declared seam onto a dead stop is exactly the case the navigator
        // resolves by walking past it rather than stranding the ring there — so
        // the expected landing is read from whether the control is live.
        const trashLive = await app.evalJS<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(TRASH)});
            return el !== null && !el.matches(':disabled, [aria-disabled="true"]');
          })()`,
        );
        // End puts the cursor on the list's last row, so the next Down is the
        // one that runs off its edge. (Interior arrows still rove — that is the
        // behavior the seam sits underneath, not one this replaces.)
        await pressKey(app, "End");
        await pressKey(app, "ArrowDown");
        await app.waitForCondition<boolean>(
          hasKeyView(trashLive ? TRASH : CANCEL),
          { timeoutMs: 3000 },
        );
        if (trashLive) {
          await pressKey(app, "ArrowDown");
          await app.waitForCondition<boolean>(hasKeyView(CANCEL), { timeoutMs: 3000 });
        }

        // Cancel and Open share a row, so they are a closed horizontal ring:
        // Right swaps to Open, Left swaps back — the affordance two stops in a
        // vertical column never had.
        await pressKey(app, "ArrowRight");
        await app.waitForCondition<boolean>(hasKeyView(OPEN), { timeoutMs: 3000 });
        await pressKey(app, "ArrowLeft");
        await app.waitForCondition<boolean>(hasKeyView(CANCEL), { timeoutMs: 3000 });

        // The grid cycles top↔bottom: Down off the last row wraps to the first,
        // whose leading member is the Browse button.
        await pressKey(app, "ArrowDown");
        await app.waitForCondition<boolean>(hasKeyView(BROWSE), { timeoutMs: 3000 });

        // Every landing came through the engine — no raw focus write behind it.
        const report = await app.evalJS<{
          violations: number;
          steals: Record<string, number>;
        } | null>(`window.__tug.getFocusInvariantReport()`);
        expect(report).not.toBeNull();
        expect(report!.violations).toBe(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
