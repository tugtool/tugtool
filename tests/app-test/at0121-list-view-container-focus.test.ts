/**
 * at0121-list-view-container-focus.test.ts — TugListView container-stop shape.
 *
 * "Ring on the component, cursor on the row." When a list is authored into a
 * `focusGroup`, the scroll **container** registers as one item-container engine
 * stop and carries the focus ring ([P05]); cell wrappers drop out of the Tab
 * order (`tabIndex=-1`), so the list is one stop, not one-per-row. On Tab the
 * movement cursor lands on the first row (`data-key-cursor`) — the ring stays on
 * the container and never moves onto a row ([P01]/[P03]).
 *
 * The gallery `TugListView (focus)` card mounts a container-stop list. The test
 * proves:
 *   - **rows are not Tab stops:** every cell wrapper is `tabIndex=-1`;
 *   - **Tab → one stop, perimeter ring on the container:** Tab lands the key view
 *     on the scroll container, which marks the whole list as the focused
 *     container with a ring on its perimeter (an inset `outline`). A list is a
 *     large scroll area, so it uses the perimeter ring rather than the behind-tint
 *     the small item-groups use ([P02], by-archetype split) — the tint lit too
 *     many pixels and drowned the cursor row;
 *   - **cursor lands on the first row:** the first cell carries `data-key-cursor`
 *     (its ring) while the container holds the key view.
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

// Container snapshot: behind-tint + suppressed ring + keyboard marker + tab stop.
const CONTAINER_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(CONTAINER)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    backgroundImage: cs.backgroundImage,
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
  backgroundImage: string;
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
        // marks itself as the focused container with a perimeter ring (an inset
        // outline), no behind-tint.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CONTAINER)}).hasAttribute("data-key-view-kbd")`,
          { timeoutMs: 6000 },
        );
        const onContainer = await app.evalJS<ContainerProbe>(CONTAINER_PROBE);
        expect(onContainer?.keyboardReached).toBe(true);
        expect(parseFloat(onContainer?.outline ?? "0")).toBeGreaterThan(0);
        expect(onContainer?.backgroundImage ?? "none").not.toContain("gradient");
        expect(onContainer?.tabIndex).toBe("0");

        // (3) The movement cursor lands on the first row — the ring stays on the
        // container ([P03]), the cursor marks the current row.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(`${DEMO} [data-tug-list-cell-index="0"]`)}).hasAttribute("data-key-cursor")`,
          { timeoutMs: 6000 },
        );
        const cursorOnFirst = await app.evalJS<boolean>(
          `document.querySelector(${JSON.stringify(`${DEMO} [data-tug-list-cell-index="0"]`)}).hasAttribute("data-key-cursor")`,
        );
        expect(cursorOnFirst).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
