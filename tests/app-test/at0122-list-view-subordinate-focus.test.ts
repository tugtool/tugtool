/**
 * at0122-list-view-subordinate-focus.test.ts — TugListView input-subordinate shape.
 *
 * For the picker shape (a filter input owns the key view + ring, the list shows
 * selection), `keyboardSubordinate` makes the list contribute ZERO Tab stops:
 * the scroll container AND every cell wrapper are `tabIndex=-1`, and the
 * container registers no engine focusable. The input is the single stop (its
 * ring rides TugInput's own taming); selection still lives on the row.
 *
 * The gallery `TugListView (focus)` card mounts a `keyboardSubordinate`
 * `selectionRequired` list. The test proves the list adds no stop:
 *   - the scroll container is `tabIndex=-1` and carries no `data-tug-focusable`;
 *   - every rendered cell wrapper is `tabIndex=-1`;
 *   - selection still lives on a row (`data-selected="true"` exists).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="lv-focus-subordinate-title"]`;
const DEMO = `${CARD} [data-testid="lv-focus-subordinate-demo"]`;
const CONTAINER = `${DEMO} [data-slot="tug-list-view"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-list-view-focus", title: "ListFocus", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 620 },
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

// The subordinate list contributes no Tab stop: container -1 + no focusable
// registration, and every rendered row -1. Selection still present.
const SUBORDINATE_PROBE = `(function(){
  var container = document.querySelector(${JSON.stringify(CONTAINER)});
  if (!container) return null;
  var rows = document.querySelectorAll(${JSON.stringify(`${DEMO} [data-tug-list-cell-index]`)});
  var rowsAllInert = rows.length > 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute("tabindex") !== "-1") rowsAllInert = false;
  }
  var selected = document.querySelector(${JSON.stringify(`${DEMO} [data-selected="true"]`)});
  return {
    containerTabIndex: container.getAttribute("tabindex"),
    containerRegistered: container.hasAttribute("data-tug-focusable"),
    rowsAllInert: rowsAllInert,
    hasSelectedRow: selected !== null,
  };
})()`;

interface SubordinateProbe {
  containerTabIndex: string | null;
  containerRegistered: boolean;
  rowsAllInert: boolean;
  hasSelectedRow: boolean;
}

describe.skipIf(!SHOULD_RUN)("AT0122: input-subordinate list contributes no Tab stop", () => {
  test(
    "container and rows are tabIndex=-1, no registration; selection on the row",
    async () => {
      const app = await launchTugApp({ testName: "at0122-list-view-subordinate-focus" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TITLE)}) !== null`,
          { timeoutMs: 8000 },
        );
        // Wait until the subordinate list has rendered rows.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(`${DEMO} [data-tug-list-cell-index]`)}).length > 0`,
          { timeoutMs: 6000 },
        );

        const probe = await app.evalJS<SubordinateProbe>(SUBORDINATE_PROBE);
        // The list contributes zero Tab stops.
        expect(probe?.containerTabIndex).toBe("-1");
        expect(probe?.containerRegistered).toBe(false);
        expect(probe?.rowsAllInert).toBe(true);
        // Selection still lives on a row (selectionRequired seeds the first row).
        expect(probe?.hasSelectedRow).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
