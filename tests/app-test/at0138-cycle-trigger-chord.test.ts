/**
 * at0138-cycle-trigger-chord.test.ts — the keyboard-focus-cycling trigger chord
 * (⌥⇥) reaches the WebView and matches its keybinding ([CYCLE_FOCUS_MODE]).
 *
 * ## Why this exists
 *
 * The cycling mode (a per-card mode in which Tab circulates the card's chrome
 * zones instead of feeding the editor) is toggled by ⌥⇥. Before any mechanism is
 * built on that chord, two things must be true and stay true:
 *
 *   1. **A native ⌥⇥ is not eaten by macOS / WebKit.** Plain Tab and Shift+Tab
 *      are consumed for full-keyboard-access focus navigation (the reason ⇧⌘ /
 *      synthetic dispatch is used elsewhere); a *modified* Tab must instead
 *      reach the document keydown listeners. This test posts a real CGEvent ⌥⇥
 *      and asserts a document listener sees it.
 *   2. **The keybinding stage matches it.** The static map binds ⌥⇥ →
 *      `CYCLE_FOCUS_MODE` with `preventDefaultOnMatch`, so on a match the
 *      capture-phase keybinding stage calls `preventDefault()` *before* dispatch
 *      — even with no handler registered yet. A capture-phase probe registered
 *      after the engine's stages therefore observes `defaultPrevented === true`,
 *      proving the chord reached AND matched the keybinding stage.
 *
 * The engine side is already clear: the focus-walk stage bails on any modifier
 * (`responder-chain-provider.tsx`), so ⌥⇥ is never consumed as a reverse-tab.
 * This test guards the OS→WebView reach + the binding match; the mode handler is
 * a later step. Resolves [Q05]: ⌥⇥ is the trigger.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const PANE_TITLE_BAR = '[data-testid="tug-pane-title-bar"]';

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-buttons", title: "Buttons", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 600 },
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

// Install a capture-phase probe. Registered after the engine's own capture
// listeners (focus-walk → keybinding → act-dispatch), so by the time it runs the
// keybinding stage has already set `defaultPrevented` on a match. Records only a
// clean ⌥⇥ (no other modifiers).
const INSTALL_PROBE = `(function(){
  window.__optTab = { reached: false, defaultPrevented: null };
  if (window.__optTabInstalled) return true;
  window.__optTabInstalled = true;
  document.addEventListener("keydown", function(e){
    if (e.code === "Tab" && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      window.__optTab = { reached: true, defaultPrevented: e.defaultPrevented };
    }
  }, true);
  return true;
})()`;

interface OptTabProbe {
  reached: boolean;
  defaultPrevented: boolean | null;
}

describe.skipIf(!SHOULD_RUN)("AT0138: the ⌥⇥ cycle trigger reaches + matches its keybinding", () => {
  test(
    "a native ⌥⇥ reaches the document and the keybinding stage matches it",
    async () => {
      const app = await launchTugApp({ testName: "at0138-cycle-trigger-chord" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(PANE_TITLE_BAR)}) !== null`,
          { timeoutMs: 8000 },
        );

        // Activate the webview so a posted CGEvent reaches the document.
        await app.nativeClickAtElement(PANE_TITLE_BAR);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });

        await app.evalJS<boolean>(INSTALL_PROBE);

        // Post a real ⌥⇥ (Option = "alt").
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`window.__optTab && window.__optTab.reached === true`, {
          timeoutMs: 6000,
        });

        const probe = await app.evalJS<OptTabProbe>(`window.__optTab`);
        // (1) The OS did not eat ⌥⇥ — a document listener saw it.
        expect(probe?.reached, "native ⌥⇥ must reach the document keydown listeners").toBe(true);
        // (2) The keybinding stage matched it (preventDefaultOnMatch fired).
        expect(
          probe?.defaultPrevented,
          "the ⌥⇥ → CYCLE_FOCUS_MODE binding must match (preventDefaultOnMatch)",
        ).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
