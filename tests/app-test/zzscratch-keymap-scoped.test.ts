/**
 * zzscratch-keymap-scoped.test.ts — ⌃⌘K, and a scoped row rebinding.
 *
 * @covers tugdeck/src/components/tugways/cards/settings-keymap-body.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;
const CONTROL = 1 << 18;
const OPTION = 1 << 19;
const COMMAND = 1 << 20;

describe.skipIf(!SHOULD_RUN)("scratch keymap scoped", () => {
  test(
    "the shortcut card has a shortcut, and a scoped row rebinds",
    async () => {
      const app = await launchTugApp({ testName: "zzscratch-scoped" });
      try {
        await app.waitForCondition<boolean>(
          `typeof window.__tug !== "undefined" && typeof window.tugdeck !== "undefined"`,
        );

        // 1. The factory default reached the menu bar.
        const item = await app.menuItemState("app.keyboardShortcuts");
        console.log("MENU", JSON.stringify(item));
        expect(item.found ? item.keyEquivalent : undefined).toBe("k");
        expect(item.found ? item.modifierMask : undefined).toBe(COMMAND | CONTROL);

        // 2. Pressing it opens the card.
        await app.nativeKey("k", ["cmd", "ctrl"]);
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-testid="settings-keymap"]') !== null`,
          { timeoutMs: 8000 },
        );

        // 3. A scoped row now offers Change.
        await app.type('[data-testid="settings-keymap-filter"] input', "Claim All");
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-testid="keymap-arm-claim-all-changes"]') !== null`,
          { timeoutMs: 8000 },
        );

        const rowText = async () =>
          await app.evalJS<string>(
            `document.querySelector('[data-testid="keymap-row-claim-all-changes"]')?.textContent ?? ""`,
          );
        console.log("BEFORE", JSON.stringify(await rowText()));

        await app.click('[data-testid="keymap-arm-claim-all-changes"]');
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-testid="keymap-capture"]') !== null`,
          { timeoutMs: 6000 },
        );
        await app.nativeKey("j", ["cmd", "ctrl", "alt"]);
        await app.waitForCondition<boolean>(
          `(document.querySelector('[data-testid="keymap-capture"] [data-pending="true"]')?.textContent ?? "").includes("J")`,
          { timeoutMs: 6000 },
        );
        await app.click('[data-testid="keymap-capture-use"]');
        await new Promise((r) => setTimeout(r, 400));

        const after = await rowText();
        console.log("AFTER", JSON.stringify(after));
        expect(after, "the new chord is on the row").toContain("J");
        expect(after, "and the row says nothing about scope").not.toContain(
          "session-composer",
        );

        // The command has no menu item, so nothing should have been claimed
        // on the menu bar by this rebind.
        const composerItem = await app.menuItemState("app.keyboardShortcuts");
        expect(composerItem.found ? composerItem.keyEquivalent : undefined).toBe("k");

        // 4. Reset puts the scoped default back.
        const RESET = '[aria-label="Reset Claim All Changes to its default chord"]';
        await app.click(RESET);
        await new Promise((r) => setTimeout(r, 400));
        const reset = await rowText();
        console.log("RESET", JSON.stringify(reset));
        expect(reset).toContain("A");
        expect(reset).not.toContain("J");
        void OPTION;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
