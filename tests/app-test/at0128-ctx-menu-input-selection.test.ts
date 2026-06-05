/**
 * at0128-ctx-menu-input-selection.test.ts — A secondary-click that opens the
 * context menu on selected text in a native TugInput must NOT drop the
 * selection, so Cut / Copy act on what the user had selected.
 *
 * Self-running reproduction for the text-context-menu-selection feature
 * ([roadmap/tugplan-text-context-menu-selection.md], step S0/S2).
 *
 * **Why a dispatched pointerdown+contextmenu, not a trusted native gesture:**
 * the failing gesture is a macOS Control-click, which arrives as `button: 0`.
 * A CGEvent ctrl+left-click in the harness does not get translated into a DOM
 * `contextmenu` (it acts as a plain caret move), and a trusted button-2
 * `nativeRightClick` hits the already-working `button === 2` capture path — so
 * neither native gesture exercises the button-0 + contextmenu path. The defect
 * itself is at the JS/adapter layer: the shared hook only snapshots the
 * selection on `button === 2`, so a button-0 contextmenu runs the adapter's
 * right-click pipeline with no snapshot, which mangles the range. Dispatching
 * the exact events the hook listens for reproduces that path deterministically.
 *
 * Against the current (unfixed) code this FAILS — the post-click selection is
 * no longer the full "hello world". The S2 fix (capture on every pointerdown)
 * makes it pass.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const PERSIST_KEY = "gallery-input/size/sm";
const inputSel = (id: string): string =>
  `[data-card-id="${id}"] [data-tug-state-key="${PERSIST_KEY}"]`;

describe.skipIf(!SHOULD_RUN)(
  "at0128-ctx-menu-input-selection: a button-0 context menu preserves the TugInput selection",
  () => {
    test("dispatching pointerdown(button 0)+contextmenu over a full selection keeps it", async () => {
      const app = await launchTugApp({ testName: "at0128-ctx-menu-input-selection" });
      try {
        await app.seedDeckState({
          state: {
            cards: [
              { id: "A", componentId: "gallery-input", title: "Card A", closable: true },
            ],
            panes: [
              {
                id: "p1",
                position: { x: 40, y: 40 },
                size: { width: 480, height: 360 },
                cardIds: ["A"],
                activeCardId: "A",
                title: "",
                acceptsFamilies: ["developer"],
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

        await app.nativeClickAtElement(inputSel("A"));
        await app.waitForCondition<boolean>(
          `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(inputSel("A"))})`,
        );
        await app.type(inputSel("A"), "hello world");

        // Select the whole value, then drive a button-0 secondary-click
        // (pointerdown + contextmenu) on the field and report the resulting
        // selection. This runs the real shared-hook + native-input-adapter
        // right-click pipeline.
        const result = await app.evalJS<{ start: number; end: number; value: string }>(
          `(() => {
            const el = document.querySelector(${JSON.stringify(inputSel("A"))});
            el.focus();
            el.setSelectionRange(0, el.value.length);
            const r = el.getBoundingClientRect();
            const x = Math.round(r.left + 25), y = Math.round(r.top + r.height / 2);
            el.dispatchEvent(new PointerEvent("pointerdown", { button: 0, ctrlKey: true, bubbles: true, clientX: x, clientY: y }));
            el.dispatchEvent(new MouseEvent("contextmenu", { button: 0, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y }));
            return { start: el.selectionStart, end: el.selectionEnd, value: el.value };
          })()`,
        );

        process.stderr.write(`\n[at0128] post-click selection: ${JSON.stringify(result)}\n`);

        // The whole "hello world" selection must survive the secondary-click.
        expect(result.value).toBe("hello world");
        expect(result).toMatchObject({ start: 0, end: 11 });
      } finally {
        await app.close();
      }
    });
  },
);
