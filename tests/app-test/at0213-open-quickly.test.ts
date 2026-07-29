/**
 * at0213-open-quickly.test.ts — the Open Quickly popup (File ▸ Open
 * Quickly, ⇧⌘O → `open-quickly` control → OpenQuicklyOverlay →
 * TugCompletionPopup).
 *
 * Drives the wiring the headless harness can exercise faithfully: the
 * control opens the deck-global popup, the search field claims focus,
 * registers as a chain responder, and accepts input, and every dismissal
 * path (Escape, outside click) closes it. The FILETREE-backed result list
 * and the file-open commit depend on a bound workspace the headless harness
 * can't provide (the same limit that makes at0051 drive `/` completion, not
 * `@`); the `FileTreeStore` provider is covered by its own tests and the
 * live app, and the `file:line` query parsing by
 * `file-location-query.test.ts`.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/lib/open-quickly-store.ts
 * @covers tugdeck/src/components/chrome/open-quickly-overlay.tsx
 * @covers tugdeck/src/components/tugways/tug-completion-popup.tsx
 * @covers tugdeck/src/lib/open-file-in-card.ts
 * @covers tugdeck/src/lib/file-location-query.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const POPUP = '[data-slot="tug-completion-popup"]';
const INPUT = ".tug-completion-popup .tug-completion-popup-input";
const BACKDROP = '[data-slot="tug-completion-popup-backdrop"]';
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

describe.skipIf(!SHOULD_RUN)("at0213: Open Quickly popup", () => {
  test(
    "open-quickly opens a focused search popup; Escape and outside-click dismiss",
    async () => {
      const app = await launchTugApp({ testName: "at0213-open-quickly" });
      try {
        // The deck (and its canvas overlay root) must be up before the
        // control has anywhere to portal.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(OVERLAY_ROOT)}) !== null`,
          { timeoutMs: 20000 },
        );

        // 1. The control opens the popup.
        await dispatchControl(app, "open-quickly");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
          { timeoutMs: 8000 },
        );

        // 2. The search field claims focus on open.
        await app.waitForCondition<boolean>(
          `document.activeElement === document.querySelector(${JSON.stringify(INPUT)})`,
          { timeoutMs: 4000 },
        );

        // 3. The field is a registered chain responder. ⌘V is a
        // capture-phase global binding dispatched to the FIRST RESPONDER, and
        // promotion walks DOM-up from the focused element to the nearest
        // `data-responder-id`. Without this attribute the popup's paste is
        // delivered to whatever surface behind it still held first responder.
        expect(
          await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(INPUT)})
               .hasAttribute("data-responder-id")`,
          ),
        ).toBe(true);

        // 4. The popup's own rules beat TugInput's boxed chrome: the field
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
        // popup's font-size-xl must be overriding.
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

        // 6. Escape dismisses.
        await app.evalJS<null>(
          `(function(){
             document.querySelector(${JSON.stringify(INPUT)}).dispatchEvent(
               new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
             return null;
           })()`,
        );
        await waitGone(app, POPUP);

        // 7. Reopen, then an outside (backdrop) press dismisses.
        await settle();
        await dispatchControl(app, "open-quickly");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.evalJS<null>(
          `(function(){
             var backdrop = document.querySelector(${JSON.stringify(BACKDROP)});
             backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
             return null;
           })()`,
        );
        await waitGone(app, POPUP);

        expect(await exists(app, POPUP)).toBe(false);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
