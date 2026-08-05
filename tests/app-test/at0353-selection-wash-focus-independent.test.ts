/**
 * at0353-selection-wash-focus-independent.test.ts — a selected row's color does
 * not move when its list takes the keyboard.
 *
 * Two area marks stack on the same pixels: the list's container focus wash (an
 * accent tint painted behind the rows while the list holds the key view) and
 * the row's selection wash (a translucent blue over whatever is behind it).
 * Composited naively, ~5% of the accent hue survives through the blue and the
 * selection turns muddy the moment the list is focused — a color nobody chose.
 * `TugListRow` resolves it by painting the selection over its own opaque ground
 * (`--tugx-ambient-surface`, published by the host that paints the surface), so
 * the selection composites against the surface and nothing else.
 *
 * Drives the real Choose Session sheet — the surface the collision was reported
 * on. It reads the selected row's resolved paint (`background-color` + the
 * `background-image` the wash rides in) with the list holding the key view and
 * again with the key view moved up to the filter field, and requires the two to
 * be identical. The container wash's own presence/absence is asserted alongside,
 * so a run where the wash never painted cannot pass vacuously.
 *
 * @covers tugdeck/src/components/tugways/tug-list-row.css
 * @covers tugdeck/src/components/tugways/tug-list-view.css
 * @covers tugdeck/src/components/tugways/tug-sheet.css
 * @covers tugdeck/src/components/tugways/cards/session-card.css
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

// The picker's stops by their stable authored focus-key, as at0342 reads them.
const FILTER = '[data-tug-focus-key="session-picker-cycle:1"]';
const SESSIONS = '[data-tug-focus-key="session-picker-cycle:2"]';
const PICKER_FORM = ".session-card-picker-form";
const PICKER_BACKDROP = ".session-card-picker-backdrop";
const SELECTED_ROW = `${PICKER_FORM} .tug-list-row[data-selected="true"]`;

// Real directories on the macOS test host, so the path seed leaves Open enabled
// and the smart latch lands the key view on the Sessions list.
const SEED_RECENTS = ["/", "/tmp", "/usr"];

/**
 * The selected row's resolved paint, the surface behind it, and whether the
 * list's wash is up. `hostSurface` is read off the element that actually paints
 * the picker's ground — the row's opaque layer has to BE that color, which is
 * the property that makes the paint focus-independent in the first place. A
 * translucent value there (the pre-fix shape: the wash straight into
 * `background-color`) means the composite is back and the ground is a fiction.
 */
const PAINT_PROBE = `(function(){
  var row = document.querySelector(${JSON.stringify(SELECTED_ROW)});
  if (!row) return null;
  var list = document.querySelector(${JSON.stringify(SESSIONS)});
  var host = document.querySelector(${JSON.stringify(PICKER_BACKDROP)});
  var rowStyle = getComputedStyle(row);
  return {
    backgroundColor: rowStyle.backgroundColor,
    backgroundImage: rowStyle.backgroundImage,
    hostSurface: host ? getComputedStyle(host).backgroundColor : null,
    containerWash: list ? getComputedStyle(list).backgroundImage : "none",
    listHasKeyView: list ? list.hasAttribute("data-key-view-kbd") : false,
  };
})()`;

interface PaintProbe {
  backgroundColor: string;
  backgroundImage: string;
  hostSurface: string | null;
  containerWash: string;
  listHasKeyView: boolean;
}

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

describe.skipIf(!SHOULD_RUN)("at0353 — the selection wash ignores the focus wash", () => {
  test(
    "a selected picker row paints identically with the list focused and unfocused",
    async () => {
      const app = await launchTugApp({
        testName: "at0353-selection-wash-focus-independent",
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        // An unbound session card presents its picker.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`,
          { timeoutMs: 8000 },
        );

        await app.evalJS<null>(
          `(window.__tug.setTugbankValue(${JSON.stringify("dev.tugtool.dev")}, ${JSON.stringify("recent-projects")}, { kind: "json", value: { paths: ${JSON.stringify(SEED_RECENTS)} } }), null)`,
        );
        // The seed lands the key view on the Sessions list once the path settles.
        await app.waitForCondition<boolean>(hasKeyView(SESSIONS), { timeoutMs: 8000 });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SELECTED_ROW)}) !== null`,
          { timeoutMs: 8000 },
        );

        // (1) List focused: the container wash is up, painted behind the rows.
        const focused = await app.evalJS<PaintProbe>(PAINT_PROBE);
        expect(focused?.listHasKeyView).toBe(true);
        expect(focused?.containerWash ?? "none").not.toBe("none");
        // The wash resolves OPAQUE here, because the picker publishes the
        // surface it paints and the wash mixes against it rather than against
        // `transparent`. An alpha term in the serialized value means the
        // publication was lost somewhere above and the mark is compositing
        // again — the state every mark stacked over it then inherits.
        expect(focused?.containerWash ?? "").not.toMatch(
          /rgba\(|\/\s*0?\.\d/,
        );
        // The row's own base layer IS the picker's surface — the ground it would
        // have composited against had it stayed translucent. This is the
        // load-bearing assertion: with the ground opaque and equal to the
        // surface, what sits behind the row (the container wash, here) cannot
        // reach the selection at all.
        expect(focused?.hostSurface).not.toBe(null);
        expect(focused?.backgroundColor).toBe(focused?.hostSurface ?? "");
        // …with the selection wash riding above it as a background layer.
        expect(focused?.backgroundImage ?? "none").not.toBe("none");

        // (2) Key view up to the filter field — the list's wash drains.
        await pressKey(app, "ArrowUp");
        await app.waitForCondition<boolean>(hasKeyView(FILTER), { timeoutMs: 3000 });
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(SESSIONS)});
            return el ? getComputedStyle(el).backgroundImage === "none" : false;
          })()`,
          { timeoutMs: 3000 },
        );
        const unfocused = await app.evalJS<PaintProbe>(PAINT_PROBE);
        expect(unfocused?.listHasKeyView).toBe(false);

        // (3) The claim: the selection is the same color either way. The list's
        // mark came and went between the two reads (asserted above), and the row
        // under it did not move a channel.
        expect(unfocused?.backgroundColor).toBe(focused?.backgroundColor ?? "");
        expect(unfocused?.backgroundImage).toBe(focused?.backgroundImage ?? "");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
