/**
 * at0109-focus-ring.test.ts — the single app-owned focus ring (focus-ring.css +
 * the --tugx-focus-ring-* theme tokens).
 *
 * One ring, on the keyboard-active control: it appears on **keyboard** focus and
 * never on a mouse click. The key view is engine state projected to the DOM as
 * `data-key-view` — internal plumbing with no visual of its own. The ring paints
 * only when that key view is *keyboard-reached* (`data-key-view-kbd`), the mark
 * the engine sets when the Tab walk (not a pointer) lands the key view.
 *
 * Under the keyboard-as-engine-state model, DOM focus rests on the app's
 * `tug-key-sink`, not on the clicked control — the engine routes keys off the
 * sink and derives the key view from its own register, so a control's ring is a
 * function of engine state, not of `document.activeElement`. The two halves:
 *
 *   - a **mouse click** parks a key view (pointer modality) on the card's
 *     focusable — `data-key-view` is set, but it is NOT `data-key-view-kbd`, so
 *     no ring paints (outline width 0). DOM focus lands on the sink, not the
 *     control;
 *   - a **keyboard** Tab drives the engine walk onto a registered focusable and
 *     marks that key view keyboard-reached (`data-key-view-kbd`), so the ring
 *     paints.
 *
 * Outline width is read from `getComputedStyle` in the real WKWebView, where the
 * ring's `data-key-view-kbd` styling actually resolves.
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
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

// Snapshot the element currently carrying the key view (whatever it is) and the
// keyboard-reached ring element (if any). A single read keeps the pointer- and
// keyboard-modality assertions consistent across one paint.
const RING_PROBE = `(function(){
  var kv = document.querySelector("[data-key-view]");
  var kbd = document.querySelector("[data-key-view-kbd]");
  var ae = document.activeElement;
  return {
    keyView: kv ? kv.getAttribute("data-key-view") : null,
    keyViewOutline: kv ? getComputedStyle(kv).outlineWidth : null,
    keyViewIsKbd: kv ? kv.hasAttribute("data-key-view-kbd") : null,
    kbdOutline: kbd ? getComputedStyle(kbd).outlineWidth : null,
    activeIsSink: ae !== null && ae.classList.contains("tug-key-sink"),
  };
})()`;

interface RingProbe {
  keyView: string | null;
  keyViewOutline: string | null;
  keyViewIsKbd: boolean | null;
  kbdOutline: string | null;
  activeIsSink: boolean;
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

        // Mouse click — parks a key view (pointer modality) on the card's
        // focusable. The key view lands, but it is not keyboard-reached, so no
        // ring paints; DOM focus rests on the sink, never on the control.
        await app.nativeClickAtElement(DEMO_TARGET);
        await app.waitForCondition<boolean>(
          `document.querySelector("[data-key-view]") !== null`,
          { timeoutMs: 6000 },
        );
        const clicked = await app.evalJS<RingProbe>(RING_PROBE);
        expect(clicked?.keyView).not.toBeNull();
        expect(clicked?.keyViewIsKbd).toBe(false);
        expect(parseFloat(clicked?.keyViewOutline ?? "0")).toBe(0);
        expect(clicked?.activeIsSink).toBe(true);

        // Keyboard Tab — drives the engine walk onto a registered focusable and
        // marks the key view keyboard-reached (`data-key-view-kbd`), so the ring
        // paints even though WebKit withholds :focus-visible from the sink's
        // programmatic focus.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `document.querySelector("[data-key-view-kbd]") !== null`,
          { timeoutMs: 6000 },
        );
        const keyboard = await app.evalJS<RingProbe>(RING_PROBE);
        expect(keyboard?.keyViewIsKbd).toBe(true);
        expect(parseFloat(keyboard?.kbdOutline ?? "0")).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
