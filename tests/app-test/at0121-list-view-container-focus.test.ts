/**
 * at0121-list-view-container-focus.test.ts — TugListView container-stop shape.
 *
 * "Ring on the focused component, selection on the row." When a list is authored
 * into a `focusGroup`, the scroll **container** registers as one engine stop
 * (`useFocusable`) and carries the focus ring ([P05]); cell wrappers drop out of
 * the Tab order (`tabIndex=-1`), so the list is one stop, not one-per-row. No row
 * cursor — a focused container scrolls natively.
 *
 * The gallery `TugListView (focus)` card mounts a container-stop list. The test
 * proves:
 *   - **rows are not Tab stops:** every cell wrapper is `tabIndex=-1`;
 *   - **Tab → one stop, ring on the container:** Tab lands the key view on the
 *     scroll container and paints the ring there.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="lv-focus-container-title"]`;
const DEMO = `${CARD} [data-testid="lv-focus-container-demo"]`;
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

// Container snapshot: ring + keyboard marker + tab stop.
const CONTAINER_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(CONTAINER)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    tabIndex: el.getAttribute("tabindex"),
  };
})()`;

// Whether EVERY rendered cell wrapper in the demo is tabIndex=-1.
const ALL_ROWS_NON_FOCUSABLE = `(function(){
  var rows = document.querySelectorAll(${JSON.stringify(`${DEMO} [data-tug-list-cell-index]`)});
  if (rows.length === 0) return false;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute("tabindex") !== "-1") return false;
  }
  return true;
})()`;

interface ContainerProbe {
  outline: string;
  keyboardReached: boolean;
  tabIndex: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0121: list-view container is a single focus stop", () => {
  test(
    "rows are not Tab stops; Tab rings the container",
    async () => {
      const app = await launchTugApp({ testName: "at0121-list-view-container-focus" });
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
        // The container registers itself as the engine focusable.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(`${CONTAINER}[data-tug-focusable]`)}) !== null`,
          { timeoutMs: 6000 },
        );

        // (1) Rows are not Tab stops — the list is one stop, not one-per-row.
        const rowsInert = await app.evalJS<boolean>(ALL_ROWS_NON_FOCUSABLE);
        expect(rowsInert).toBe(true);

        // Activate the webview and wait until the document holds key focus.
        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // (2) Tab → the container is the one stop: it takes the key view and
        // the ring paints on it.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CONTAINER)}).hasAttribute("data-key-view-kbd")`,
          { timeoutMs: 6000 },
        );
        const onContainer = await app.evalJS<ContainerProbe>(CONTAINER_PROBE);
        expect(onContainer?.keyboardReached).toBe(true);
        expect(parseFloat(onContainer?.outline ?? "0")).toBeGreaterThan(0);
        expect(onContainer?.tabIndex).toBe("0");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
