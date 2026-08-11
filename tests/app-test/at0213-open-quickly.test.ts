/**
 * at0213-open-quickly.test.ts — the Open Quickly dialog (File ▸ Open Quickly,
 * ⇧⌘O → `open-quickly` control → OpenQuicklyOverlay → TugModalInputDialog).
 *
 * This file covers the dialog's own behavior with no search root: the control
 * opens the deck-global dialog, the query field claims focus, registers as a
 * chain responder, and accepts input, and every dismissal path closes it. The
 * FILETREE-backed result list and the file-open commit need a registered
 * workspace, which at0306 provides by pointing the default project directory at
 * a temp tree — so the two files together cover the surface end to end. The
 * `file:line` query parsing is covered by `file-location-query.test.ts`.
 *
 * The dismissal list is the point of the rework, and it is now closed and
 * short: the Escape ladder, ⌘., an outside interaction, an app switch, and the
 * commit. The old popup had, on top of those, an `onBlur` with three
 * exemptions, a caller-supplied `dismissGuard`, and a backdrop `onMouseDown` —
 * an apparatus that existed to approximate modality. Real modality replaced it,
 * which is why the outside-click test below asserts a second thing it never
 * used to: that the click did not activate what it landed on.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @foreground
 * @covers tugdeck/src/lib/open-quickly-store.ts
 * @covers tugdeck/src/components/chrome/open-quickly-overlay.tsx
 * @covers tugdeck/src/components/tugways/tug-modal-input-dialog.tsx
 * @covers tugdeck/src/lib/open-file-in-card.ts
 * @covers tugdeck/src/lib/file-location-query.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const PANEL = '[data-slot="tug-modal-input-dialog"]';
const INPUT = ".tug-modal-input-dialog .tug-modal-input-dialog-input";
const OVERLAY = '[data-slot="tug-modal-input-dialog-overlay"]';
const OVERLAY_ROOT = '[data-slot="tug-canvas-overlay-root"]';

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

async function dispatchControl(app: App, action: string): Promise<void> {
  await app.evalJS<null>(
    `(window.__tug.dispatchControlAction(${JSON.stringify(action)}), null)`,
  );
}

async function exists(app: App, selector: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.querySelector(${JSON.stringify(selector)}) !== null`,
  );
}

async function waitGone(app: App, selector: string, timeoutMs = 8000): Promise<void> {
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(selector)}) === null`,
    { timeoutMs },
  );
}

async function openDialog(app: App): Promise<void> {
  await dispatchControl(app, "open-quickly");
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(PANEL)}) !== null`,
    { timeoutMs: 8000 },
  );
}

describe.skipIf(!SHOULD_RUN)("at0213: Open Quickly dialog", () => {
  test(
    "open-quickly opens a focused, app-modal search dialog that accepts input",
    async () => {
      const app = await launchTugApp({ testName: "at0213-open-quickly" });
      try {
        // The deck (and its canvas overlay root) must be up before the
        // control has anywhere to portal.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(OVERLAY_ROOT)}) !== null`,
          { timeoutMs: 20000 },
        );

        // 1. The control opens the dialog, with its blocking overlay.
        await openDialog(app);
        expect(await exists(app, OVERLAY)).toBe(true);

        // 2. The query field claims focus on open — typing-first.
        await app.waitForCondition<boolean>(
          `document.activeElement === document.querySelector(${JSON.stringify(INPUT)})`,
          { timeoutMs: 4000 },
        );

        // 3. The field is a registered chain responder. ⌘V is a
        // capture-phase global binding dispatched to the FIRST RESPONDER, and
        // promotion walks DOM-up from the focused element to the nearest
        // `data-responder-id`. Without this attribute the dialog's paste is
        // delivered to whatever surface behind it still held first responder.
        expect(
          await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(INPUT)})
               .hasAttribute("data-responder-id")`,
          ),
        ).toBe(true);

        // 4. The dialog's own rules beat TugInput's boxed chrome: the field
        // renders as a bare search line on the panel surface, not a 32px
        // bordered box with its own fill.
        const fieldChrome = await app.evalJS<{
          bg: string;
          border: string;
          pad: string;
          size: number;
        }>(
          `(function(){
             var s = getComputedStyle(
               document.querySelector(${JSON.stringify(INPUT)}));
             return {
               bg: s.backgroundColor,
               border: s.borderTopStyle,
               pad: s.paddingLeft,
               size: parseFloat(s.fontSize),
             };
           })()`,
        );
        expect(fieldChrome.bg).toBe("rgba(0, 0, 0, 0)");
        expect(fieldChrome.border).toBe("none");
        expect(fieldChrome.pad).toBe("0px");
        // Larger than TugInput's md size variant (font-size-sm), which the
        // dialog's font-size-xl must be overriding.
        expect(fieldChrome.size).toBeGreaterThan(16);

        // 5. It is a live controlled input — typing lands in the field.
        await app.evalJS<null>(
          `(function(){
             var input = document.querySelector(${JSON.stringify(INPUT)});
             var setter = Object.getOwnPropertyDescriptor(
               window.HTMLInputElement.prototype, "value").set;
             setter.call(input, "readme");
             input.dispatchEvent(new Event("input", { bubbles: true }));
             return null;
           })()`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(INPUT)}).value === "readme"`,
          { timeoutMs: 4000 },
        );

        // 6. Escape dismisses — the engine's ladder, not a field handler.
        await app.nativeKey("Escape");
        await waitGone(app, PANEL);
        // …and the overlay goes with it. A blocking overlay left standing over
        // a dismissed dialog is a deck nothing can be clicked on.
        expect(await exists(app, OVERLAY)).toBe(false);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "⌘. dismisses, and an outside click dismisses without activating what it hit",
    async () => {
      const app = await launchTugApp({
        testName: "at0213-open-quickly-dismiss",
        // ⌘. is only delivered to an app that is actually frontmost — the
        // background pid-mode default drops it and only the bare `Meta`
        // keydown reaches the page. Same reason at0151 runs foreground.
        foreground: true,
      });
      try {
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(OVERLAY_ROOT)}) !== null`,
          { timeoutMs: 20000 },
        );

        // ⌘. — the macOS cancel chord, new with the modal shell.
        await openDialog(app);
        await app.nativeKey(".", ["cmd"]);
        await waitGone(app, PANEL);

        // An outside click dismisses (launcher posture), and the overlay
        // swallows it so nothing beneath activates. The proof is a deck that
        // did not change: the click lands where the empty deck's own surface
        // is, and if the overlay had let it through, the deck would have taken
        // it as an activation.
        await settle();
        const deckBefore = await app.evalJS<string>(
          `JSON.stringify(window.tugdeck.diag.getDeckState())`,
        );
        await openDialog(app);

        // A point well outside the panel — the panel sits ~22vh down and is at
        // most 680px wide, so the top-left corner region is never under it.
        const outside = await app.evalJS<{ x: number; y: number }>(
          `(function(){
             var r = document.querySelector(${JSON.stringify(PANEL)}).getBoundingClientRect();
             return { x: Math.max(8, Math.round(r.left / 2)), y: 8 };
           })()`,
        );
        note(`outside click at ${outside.x},${outside.y}`);
        await app.nativeClick(outside);
        await waitGone(app, PANEL);

        // Nothing beneath the overlay was activated by that press.
        await settle(500);
        const deckAfter = await app.evalJS<string>(
          `JSON.stringify(window.tugdeck.diag.getDeckState())`,
        );
        expect(deckAfter).toBe(deckBefore);
        expect(await exists(app, OVERLAY)).toBe(false);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
