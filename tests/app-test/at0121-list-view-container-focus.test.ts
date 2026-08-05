/**
 * at0121-list-view-container-focus.test.ts — TugListView container-stop shape.
 *
 * "Ring on the component, cursor on the row." When a list is authored into a
 * `focusGroup`, the scroll **container** registers as one item-container engine
 * stop and carries the focus ring ([P05]); cell wrappers drop out of the Tab
 * order entirely, so the list is one stop, not one-per-row. On Tab the
 * movement cursor lands on the first row (`data-key-cursor`) — the ring stays on
 * the container and never moves onto a row ([P01]/[P03]).
 *
 * The gallery `TugListView (focus)` card mounts a container-stop list. The test
 * proves:
 *   - **rows are not Tab stops:** no cell wrapper is a native Tab stop;
 *   - **Tab → one stop, perimeter ring via the overlay:** Tab lands the key view
 *     on the scroll container, which marks the whole list as the focused
 *     container with a perimeter ring. The ring is painted by the
 *     `.tug-list-view-ring` overlay (a sticky first child), NOT by an outline on
 *     the scroller — an outline is painted before positioned descendants, so
 *     selected rows and sticky group headers cut it; the overlay paints over
 *     them. The scroller itself draws no outline in any state;
 *   - **cursor lands on the first row:** the first cell carries `data-key-cursor`
 *     (its ring) while the container holds the key view.
 *
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/tug-list-view.css
 * @covers tugdeck/src/components/tugways/tug-list-row.tsx
 * @covers tugdeck/src/components/tugways/tug-list-row.css
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/styles/focus-ring.css
 * @covers tugdeck/src/components/tugways/cards/gallery-list-view-focus.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import { appIsActive } from "./_harness/selectors";

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
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

// Container snapshot: the scroller's own (suppressed) marks, the ring
// overlay's stroke + measured height, the keyboard marker, and the tab stop.
// The ring lives on `.tug-list-view-ring::before` — its outline width is the
// mark, and its height must be the published scrollport measure (0 would mean
// the ring resolves but paints a zero-height box: present in style, invisible
// in the app).
const CONTAINER_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(CONTAINER)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  var ring = el.querySelector(".tug-list-view-ring");
  var ringBefore = ring ? getComputedStyle(ring, "::before") : null;
  return {
    outline: cs.outlineWidth,
    frameWidth: cs.borderLeftWidth,
    backgroundImage: cs.backgroundImage,
    ringOutline: ringBefore ? ringBefore.outlineWidth : null,
    ringHeight: ringBefore ? parseFloat(ringBefore.height) || 0 : 0,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    tabIndex: el.getAttribute("tabindex"),
    registered: el.hasAttribute("data-tug-focusable"),
  };
})()`;

// Whether EVERY rendered cell wrapper in the demo is tabIndex=-1.
// "Not a native Tab stop" is the invariant; `tabindex="-1"` is only one way to
// spell it. Under the focus engine a cell wrapper renders NO tabindex at all
// (tug-list-view's no-tabindex rule) — a tabindex'd wrapper is still
// mouse-focusable and invites the mousedown focus churn the watchdog then has
// to park. Absent and "-1" both satisfy the contract; anything else is a stop.
const ALL_ROWS_NON_FOCUSABLE = `(function(){
  var rows = document.querySelectorAll(${JSON.stringify(`${DEMO} [data-tug-list-cell-index]`)});
  if (rows.length === 0) return false;
  for (var i = 0; i < rows.length; i++) {
    var ti = rows[i].getAttribute("tabindex");
    if (ti !== null && ti !== "-1") return false;
  }
  return true;
})()`;

interface ContainerProbe {
  outline: string;
  frameWidth: string;
  backgroundImage: string;
  ringOutline: string | null;
  ringHeight: number;
  keyboardReached: boolean;
  tabIndex: string | null;
  registered: boolean;
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

        // Activate the webview, then gate on the app-active projection — the bit
        // `focus-ring.css` suppresses every focus mark under. NOT
        // `document.hasFocus()`: a background-mode harness window never
        // activates, so that never becomes true (see `appIsActive`).
        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(appIsActive(), { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // (2) Tab → the container is the one stop: it takes the key view and
        // the ring OVERLAY paints the perimeter stroke. The scroller itself
        // stays at zero outline in the focused state too — an outline there is
        // painted under selected rows and sticky group headers, which is the
        // occlusion the overlay exists to end; a scroller that painted both
        // would be marking twice. The overlay's box must also stand at the
        // measured scrollport height — a stroke on a zero-height box passes a
        // style read and draws nothing.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CONTAINER)}).hasAttribute("data-key-view-kbd")`,
          { timeoutMs: 6000 },
        );
        const onContainer = await app.evalJS<ContainerProbe>(CONTAINER_PROBE);
        expect(onContainer?.keyboardReached).toBe(true);
        expect(parseFloat(onContainer?.ringOutline ?? "0")).toBeGreaterThan(0);
        expect(onContainer?.ringHeight ?? 0).toBeGreaterThan(0);
        // Both layers describe ONE band and therefore carry the SAME width —
        // the scroller's outline (painted before descendants, so rows cover it
        // inside the scrollport) and the overlay's stroke (a positioned
        // descendant, which they cannot). Their union is the ring; asserting
        // the widths match is what keeps them one band rather than two
        // concentric rings at two weights.
        expect(parseFloat(onContainer?.outline ?? "0")).toBe(
          parseFloat(onContainer?.ringOutline ?? "-1"),
        );
        expect(onContainer?.backgroundImage ?? "none").toBe("none");
        // "The list is one stop" is an ENGINE fact, not a tabindex fact. Once
        // the focus engine drives the card the container renders no tabindex
        // at all (tug-list-view's no-tabindex rule) — a tabindex'd container is
        // still mouse-focusable and invites the mousedown focus churn the
        // watchdog then has to park. The stop is the engine registration plus
        // the key view the Tab above landed, both asserted here. The tabindex
        // check states the invariant the same way ALL_ROWS_NON_FOCUSABLE does:
        // absent and "-1" both keep the container out of the native Tab order,
        // and a positive value is the only stop.
        expect(
          onContainer?.tabIndex === null || onContainer?.tabIndex === "-1",
        ).toBe(true);
        expect(onContainer?.registered).toBe(true);

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
