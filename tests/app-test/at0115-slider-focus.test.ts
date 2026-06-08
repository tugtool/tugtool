/**
 * at0115-slider-focus.test.ts — TugSlider focus is engine-driven.
 *
 * The slider's **thumb** is the keyboard target, so it (not the wrapper)
 * registers as a focusable when a surface authors the slider into a focus group
 * ([P02]). The engine lands the key view on the thumb and the ring paints on
 * **keyboard** focus only ([P05], driven by `data-key-view-kbd`). Arrow keys
 * step the value natively (Radix); the thumb's local `outline: none` was removed
 * so the engine ring is visible.
 *
 * The gallery `Focus Walk` panel authors one slider (min 0, max 100, step 5,
 * value 30) into a focus group. The test proves:
 *   - **no ring at rest:** before keyboard focus the thumb has no ring (outline
 *     0, no `data-key-view-kbd`);
 *   - **Tab → ring + behind-tint on keyboard focus:** Tab lands the key view on
 *     the thumb, paints the ring (outline > 0, `data-key-view-kbd` set) and the
 *     faint behind-tint on the whole component, and fills the thumb with the
 *     role color ([P01] leaf signature);
 *   - **arrows step locally:** ArrowRight increases `aria-valuenow` by one step.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="slider-focus-title"]`;
const THUMB = `${CARD} [data-testid="slider-focus-demo"] .tug-slider-thumb`;
// The ring marks the whole component, not the thumb: the thumb stays the
// keyboard key-view target (Radix arrow-stepping), but the app ring paints on
// the slider root that wraps the track/value/label. So keyboard markers are
// read on the THUMB and the ring outline is read on the SLIDER root.
const SLIDER = `${CARD} [data-testid="slider-focus-demo"] .tug-slider`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-slider", title: "Slider", closable: true }],
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

// Per-element snapshot: Radix value + computed ring + behind-tint + thumb fill
// + keyboard marker.
const PROBE = (selector: string) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    valueNow: el.getAttribute("aria-valuenow"),
    outline: cs.outlineWidth,
    behindTint: cs.backgroundImage,
    fill: cs.backgroundColor,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    isKeyView: el.hasAttribute("data-key-view"),
  };
})()`;

interface SliderProbe {
  valueNow: string | null;
  outline: string;
  behindTint: string;
  fill: string;
  keyboardReached: boolean;
  isKeyView: boolean;
}

describe.skipIf(!SHOULD_RUN)("AT0115: slider focus is engine-driven", () => {
  test(
    "no ring at rest; Tab lands the key view on the thumb and rings; arrows step the value",
    async () => {
      const app = await launchTugApp({ testName: "at0115-slider-focus" });
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
          `document.querySelectorAll(${JSON.stringify(`${CARD} [data-tug-focusable]`)}).length >= 1`,
          { timeoutMs: 6000 },
        );

        // Activate the webview by clicking the (non-interactive) panel title, so
        // native Tab reaches the document focus-walk listener — without landing
        // focus on the thumb.
        await app.nativeClickAtElement(TITLE);
        await new Promise((resolve) => setTimeout(resolve, 200));

        // (1) No ring/tint at rest: the thumb carries no keyboard marker, the
        // slider component carries no ring and no behind-tint, and the thumb is
        // at its resting (neutral) fill.
        const atRest = await app.evalJS<SliderProbe>(PROBE(THUMB));
        expect(atRest?.keyboardReached).toBe(false);
        const thumbFillAtRest = atRest?.fill ?? "";
        const sliderAtRest = await app.evalJS<SliderProbe>(PROBE(SLIDER));
        expect(parseFloat(sliderAtRest?.outline ?? "0")).toBe(0);
        expect(sliderAtRest?.behindTint).toBe("none");

        // (2) Tab → the engine lands the key view on the thumb; the ring AND the
        // behind-tint paint on the whole component (the slider root), and the
        // thumb fills with the role color ([P01] leaf signature).
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(THUMB)}); return el && el.hasAttribute("data-key-view-kbd"); })()`,
          { timeoutMs: 6000 },
        );
        const focused = await app.evalJS<SliderProbe>(PROBE(THUMB));
        expect(focused?.isKeyView).toBe(true);
        // Thumb fill changed from its resting neutral to the role fill.
        expect(focused?.fill).not.toBe(thumbFillAtRest);
        const sliderFocused = await app.evalJS<SliderProbe>(PROBE(SLIDER));
        expect(parseFloat(sliderFocused?.outline ?? "0")).toBeGreaterThan(0);
        expect(sliderFocused?.behindTint.startsWith("linear-gradient")).toBe(true);
        const before = parseFloat(focused?.valueNow ?? "NaN");
        expect(Number.isNaN(before)).toBe(false);

        // (3) ArrowRight steps the value locally (Radix), one step (5) up.
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(THUMB)}); return el && parseFloat(el.getAttribute("aria-valuenow")) > ${before}; })()`,
          { timeoutMs: 6000 },
        );
        const after = await app.evalJS<SliderProbe>(PROBE(THUMB));
        expect(parseFloat(after?.valueNow ?? "NaN")).toBe(before + 5);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
