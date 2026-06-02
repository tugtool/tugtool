/**
 * at0105-permission-cycle-keys.test.ts — permission-mode cycling is on ⇧⌘P,
 * and Shift+Tab does NOT cycle it.
 *
 * Tug departs from the Claude Code TUI: the terminal cycles the permission mode
 * on Shift+Tab, but in a GUI Shift+Tab must be reverse-focus navigation. The
 * cycle moved to the ⇧⌘P chord (key-card scope). This pins both halves of the
 * deviation at runtime:
 *   - ⇧⌘P advances the mode (Default → Accept Edits), visible on the Mode chip.
 *   - Shift+Tab then leaves it at Accept Edits — if Shift+Tab still cycled it
 *     would advance to Plan.
 *
 * Delivery: a synthetic `KeyboardEvent` dispatched on the focused element, the
 * canonical pattern for keybinding tests here (see at0085). `matchKeybinding`
 * keys purely on `event.code` + modifiers and the focus-walk stage on
 * `event.key`/modifiers — neither checks `isTrusted` — so a synthetic keydown
 * exercises the exact pipeline a real keystroke would, without the OS input
 * stack between (a native ⌘-Shift chord is routed/intercepted by windowserver
 * before it reaches the WKWebView). The binding's static contract is
 * additionally pinned by the pure-logic `keybinding-map.test.ts`.
 *
 * Has teeth: under the previous behavior (Shift+Tab folded into the focus walk
 * as the cycle) the second dispatch advanced Accept Edits → Plan and the final
 * assertion would fail; a broken ⇧⌘P binding fails the first.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0105-session";

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const MODE_CHIP = `${CARD} [data-slot="permission-mode-chip"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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

function chipTitleExpr(): string {
  return `(function(){ var e = document.querySelector(${JSON.stringify(MODE_CHIP)}); return e ? e.getAttribute("title") : null; })()`;
}

/**
 * Dispatch a synthetic keydown on the focused element. `code`/`key` and the
 * modifier flags are exactly what the Stage-1 keybinding match and the
 * focus-walk stage read.
 */
function dispatchKeyExpr(
  code: string,
  key: string,
  mods: { meta?: boolean; shift?: boolean },
): string {
  return `(function(){
    var t = document.activeElement || document;
    return t.dispatchEvent(new KeyboardEvent("keydown", {
      code: ${JSON.stringify(code)},
      key: ${JSON.stringify(key)},
      metaKey: ${mods.meta === true},
      shiftKey: ${mods.shift === true},
      bubbles: true,
      cancelable: true,
      composed: true,
    }));
  })()`;
}

describe.skipIf(!SHOULD_RUN)("AT0105: cycle on ⇧⌘P, never on Shift+Tab", () => {
  test(
    "⇧⌘P advances the permission mode; a following Shift+Tab does not",
    async () => {
      const app = await launchTugApp({ testName: "at0105-permission-cycle-keys" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        // The Mode chip starts at Default (what tugcode spawns with).
        await app.waitForCondition<boolean>(
          `${chipTitleExpr()} === "Permission mode: Default"`,
          { timeoutMs: 8000 },
        );

        // Focus the card so the key-card-scoped chord resolves a key card, and
        // wait for the first responder to land inside it.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.waitForCondition<boolean>(
          `(function(){ var c = document.querySelector(${JSON.stringify(PROMPT_INPUT)}); var fr = document.querySelector("[data-first-responder]"); var card = document.querySelector(${JSON.stringify(CARD)}); return c !== null && c.contains(document.activeElement) && fr !== null && card !== null && card.contains(fr); })()`,
          { timeoutMs: 6000 },
        );

        // ⇧⌘P → Default advances to Accept Edits.
        await app.evalJS<boolean>(dispatchKeyExpr("KeyP", "P", { meta: true, shift: true }));
        await app.waitForCondition<boolean>(
          `${chipTitleExpr()} === "Permission mode: Accept Edits"`,
          { timeoutMs: 6000 },
        );

        // Shift+Tab must NOT cycle: had it cycled, Accept Edits → Plan. Give
        // any (incorrect) cycle a window to land, then assert it stayed put.
        await app.evalJS<boolean>(dispatchKeyExpr("Tab", "Tab", { shift: true }));
        await new Promise((resolve) => setTimeout(resolve, 750));
        const after = await app.evalJS<string | null>(chipTitleExpr());
        expect(after).toBe("Permission mode: Accept Edits");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
