/**
 * at0213-open-quickly.test.ts — the Open Quickly popup (File ▸ Open
 * Quickly, ⇧⌘O → `open-quickly` control → OpenQuicklyOverlay →
 * TugCompletionPopup).
 *
 * Drives the wiring the headless harness can exercise faithfully: the
 * control opens the deck-global popup, the search field claims focus and
 * accepts input, and every dismissal path (Escape, outside click) closes
 * it. The FILETREE-backed result list and the file-open commit depend on a
 * bound workspace the headless harness can't provide (the same limit that
 * makes at0051 drive `/` completion, not `@`); the `FileTreeStore`
 * provider is covered by its own tests and the live app.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const POPUP = '[data-slot="tug-completion-popup"]';
const INPUT = '[data-slot="tug-completion-popup-input"]';
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

        // 3. It is a live controlled input — typing lands in the field.
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

        // 4. Escape dismisses.
        await app.evalJS<null>(
          `(function(){
             document.querySelector(${JSON.stringify(INPUT)}).dispatchEvent(
               new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
             return null;
           })()`,
        );
        await waitGone(app, POPUP);

        // 5. Reopen, then an outside (backdrop) press dismisses.
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
