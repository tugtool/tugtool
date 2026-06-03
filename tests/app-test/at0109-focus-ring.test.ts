/**
 * at0109-focus-ring.test.ts — the single app-owned focus ring (focus-ring.css +
 * the --tugx-focus-ring-* theme tokens).
 *
 * One ring, on the keyboard-active control: it appears on **keyboard** focus
 * (`:focus-visible`) and never on a mouse click. There is no always-on marker —
 * the focus engine still tracks `data-key-view` for the Tab walk, but that is
 * internal plumbing with no visual of its own.
 *
 * Two halves:
 *   - a **mouse click** on the `Dynamic Keybinding` panel target
 *     (`keybinding-demo-target`, a `tabIndex=0` responder) promotes it to the
 *     key view (`data-key-view`) but is not `:focus-visible`, so no ring paints
 *     (outline width 0);
 *   - a **keyboard** Tab drives the engine walk onto a registered focusable
 *     (the `Focus Walk` panel), and that key-view element is `:focus-visible`,
 *     so the ring paints.
 *
 * Outline width is read from `getComputedStyle` in the real WKWebView, where the
 * `:focus-visible` heuristic actually lives.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const DEMO = `${CARD} [data-testid="keybinding-demo"]`;
const DEMO_TARGET = `${CARD} [data-testid="keybinding-demo-target"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-chain-actions", title: "Chain", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 520 },
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

// Snapshot a selector's key-view + focus-visible state and its computed outline.
const PROBE = (selector: string) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    keyView: el.getAttribute("data-key-view"),
    focusVisible: el.matches(":focus-visible"),
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    width: cs.outlineWidth,
  };
})()`;

// Snapshot the element currently carrying the key view (whatever it is).
const KEY_VIEW_PROBE = `(function(){
  var el = document.querySelector("[data-key-view]");
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    keyView: el.getAttribute("data-key-view"),
    focusVisible: el.matches(":focus-visible"),
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    width: cs.outlineWidth,
  };
})()`;

interface RingProbe {
  keyView: string | null;
  focusVisible: boolean;
  keyboardReached: boolean;
  width: string;
}

describe.skipIf(!SHOULD_RUN)("AT0109: single focus ring on the keyboard-active control", () => {
  test(
    "a mouse click paints no ring; keyboard focus paints the ring",
    async () => {
      const app = await launchTugApp({ testName: "at0109-focus-ring" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DEMO)}) !== null`,
          { timeoutMs: 8000 },
        );

        // Mouse click — promotes the target to the key view, but pointer focus
        // is not :focus-visible, so no ring paints.
        await app.nativeClickAtElement(DEMO_TARGET);
        await app.waitForCondition<boolean>(
          `(function(){ var t = document.querySelector(${JSON.stringify(DEMO_TARGET)}); return t !== null && t.contains(document.activeElement); })()`,
          { timeoutMs: 6000 },
        );
        const clicked = await app.evalJS<RingProbe>(PROBE(DEMO_TARGET));
        expect(clicked?.keyView).toBe("keybinding-demo");
        expect(clicked?.focusVisible).toBe(false);
        expect(parseFloat(clicked?.width ?? "0")).toBe(0);

        // Keyboard Tab — drives the engine walk onto a registered focusable.
        // The engine marks the key view as keyboard-reached (`data-key-view-kbd`),
        // so the ring paints even though WebKit withholds :focus-visible from the
        // programmatic focus.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `document.querySelector("[data-key-view-kbd]") !== null`,
          { timeoutMs: 6000 },
        );
        const keyboard = await app.evalJS<RingProbe>(KEY_VIEW_PROBE);
        expect(keyboard?.keyboardReached).toBe(true);
        expect(parseFloat(keyboard?.width ?? "0")).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
