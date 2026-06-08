/**
 * at0114-switch-focus.test.ts — TugSwitch focus is engine-driven.
 *
 * The switch registers as a focusable when a surface authors it into a focus
 * group ([P02]); the engine lands the key view on the Radix Root and the global
 * ring paints on **keyboard** focus only ([P05]). Space toggles natively
 * (Radix); a mouse click toggles without painting the keyboard ring.
 *
 * The gallery `Focus Walk` panel authors two labelled switches into one focus
 * group (`switch-focus-a` order 0, `switch-focus-b` order 1). Because they carry
 * a visible label, each track sits inside a `.tug-switch-wrapper`, and the leaf
 * focus ring wraps the whole component — track AND label ([P02]) — so the ring
 * paints on the WRAPPER, not the track. The test proves:
 *   - **click → no keyboard ring:** a fresh mouse click toggles the switch
 *     (`data-state` flips) but paints no ring on the wrapper (outline 0, not
 *     `data-key-view-kbd`);
 *   - **Tab → ring on keyboard focus:** Tab lands the key view on the first
 *     switch track (`data-key-view-kbd`) and the ring paints on its wrapper
 *     (wrapper outline > 0) while the track's own outline stays 0;
 *   - **Space toggles:** Space on the focused switch flips its `data-state`;
 *   - **Tab walks to the next stop:** a second Tab moves the key view to `b`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="switch-focus-title"]`;
const SW_A = `${CARD} [data-testid="switch-focus-a"]`;
const SW_B = `${CARD} [data-testid="switch-focus-b"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-switch", title: "Switch", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 720 },
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

// The data-testid of the element currently carrying the key view, or null.
const KEY_VIEW_TESTID = `(function(){
  var el = document.querySelector("[data-key-view]");
  return el ? el.getAttribute("data-testid") : null;
})()`;

// Per-element snapshot: Radix checked state + keyboard markers on the track, plus
// the ring on its enclosing wrapper (the leaf ring wraps track + label, so it
// paints on the `.tug-switch-wrapper`, not the track itself).
const PROBE = (selector: string) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  var wrap = el.closest(".tug-switch-wrapper");
  var wcs = wrap ? getComputedStyle(wrap) : null;
  return {
    state: el.getAttribute("data-state"),
    outline: cs.outlineWidth,
    wrapperOutline: wcs ? wcs.outlineWidth : null,
    focusVisible: el.matches(":focus-visible"),
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
  };
})()`;

interface SwProbe {
  state: string | null;
  outline: string;
  wrapperOutline: string | null;
  focusVisible: boolean;
  keyboardReached: boolean;
}

describe.skipIf(!SHOULD_RUN)("AT0114: switch focus is engine-driven", () => {
  test(
    "click toggles without a ring; Tab rings and Space toggles; Tab walks to the next stop",
    async () => {
      const app = await launchTugApp({ testName: "at0114-switch-focus" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TITLE)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(`${CARD} [data-tug-focusable]`)}).length >= 2`,
          { timeoutMs: 6000 },
        );

        // (1) A fresh mouse click toggles the switch and activates the webview,
        // but paints no keyboard ring.
        await app.nativeClickAtElement(SW_A);
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(SW_A)}); return el && el.getAttribute("data-state") === "checked"; })()`,
          { timeoutMs: 6000 },
        );
        // No keyboard ring on click: the ring is driven by data-key-view-kbd
        // alone, which the engine does not set on a pointer move — so the outline
        // stays 0 even though WebKit still matches :focus-visible on the native
        // button (no longer a ring trigger). [P05] revised.
        const clicked = await app.evalJS<SwProbe>(PROBE(SW_A));
        expect(clicked?.keyboardReached).toBe(false);
        expect(parseFloat(clicked?.wrapperOutline ?? "0")).toBe(0);

        // (2) Tab → the engine lands the key view on the first switch and the
        // ring paints.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "switch-focus-a"`, {
          timeoutMs: 6000,
        });
        const focused = await app.evalJS<SwProbe>(PROBE(SW_A));
        expect(focused?.keyboardReached).toBe(true);
        // The ring wraps track + label: it paints on the wrapper, not the track.
        expect(parseFloat(focused?.wrapperOutline ?? "0")).toBeGreaterThan(0);
        expect(parseFloat(focused?.outline ?? "0")).toBe(0);

        // (3) Space toggles the focused switch (checked → unchecked).
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(SW_A)}); return el && el.getAttribute("data-state") === "unchecked"; })()`,
          { timeoutMs: 6000 },
        );

        // (4) Tab → the key view walks to the second authored stop.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "switch-focus-b"`, {
          timeoutMs: 6000,
        });
        const onB = await app.evalJS<SwProbe>(PROBE(SW_B));
        expect(onB?.keyboardReached).toBe(true);
        expect(parseFloat(onB?.wrapperOutline ?? "0")).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
