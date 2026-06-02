/**
 * at0109-focus-ring-tiers.test.ts — the single app-owned focus-ring primitive
 * paints two tiers off one token set (focus-ring.css + the --tugx-focus-ring-*
 * theme tokens).
 *
 * The contract under test:
 *   - **Tier 1 (key view, always on).** When a control becomes the key view
 *     (`data-key-view`) via a mouse click — pointer focus, which the browser
 *     does not deem `:focus-visible` — a faint 1px hairline marks it so "where
 *     do keys go?" is answerable at rest.
 *   - **Tier 2 (keyboard nav).** Once focus is keyboard-driven (`:focus-visible`)
 *     the full 2px action/blue ring paints. Tier 2 is authored after Tier 1 at
 *     equal specificity, so on the key view it wins when both match.
 *
 * The gallery `Dynamic Keybinding` panel's target (`keybinding-demo-target`) is
 * a `tabIndex=0` responder: clicking it promotes it to first responder, which
 * the FocusManager projects as `data-key-view`. The same element is then driven
 * with keyboard focus to observe Tier 2. Outline width (1px vs 2px) is the
 * discriminator — robust against color resolution — read from `getComputedStyle`
 * in the real WKWebView, where the `:focus-visible` heuristic actually lives.
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

// Snapshot the target's key-view + focus-visible state and its computed outline.
const PROBE = (extra: string) => `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO_TARGET)});
  if (!el) return null;
  ${extra}
  var cs = getComputedStyle(el);
  return {
    keyView: el.getAttribute("data-key-view"),
    focusVisible: el.matches(":focus-visible"),
    width: cs.outlineWidth,
    style: cs.outlineStyle,
  };
})()`;

interface RingProbe {
  keyView: string | null;
  focusVisible: boolean;
  width: string;
  style: string;
}

describe.skipIf(!SHOULD_RUN)("AT0109: two-tier focus-ring primitive", () => {
  test(
    "click shows the Tier-1 hairline; keyboard nav shows the Tier-2 ring",
    async () => {
      const app = await launchTugApp({ testName: "at0109-focus-ring-tiers" });
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

        // Tier 1 — a mouse click promotes the target to first responder, which
        // the FocusManager projects as the key view. Pointer focus is not
        // :focus-visible, so the faint 1px hairline marks it.
        await app.nativeClickAtElement(DEMO_TARGET);
        await app.waitForCondition<boolean>(
          `(function(){ var t = document.querySelector(${JSON.stringify(DEMO_TARGET)}); return t !== null && t.contains(document.activeElement); })()`,
          { timeoutMs: 6000 },
        );
        const tier1 = await app.evalJS<RingProbe>(PROBE(""));
        expect(tier1?.keyView).toBe("keybinding-demo");
        expect(tier1?.focusVisible).toBe(false);
        expect(tier1?.style).toBe("solid");
        expect(tier1?.width).toBe("1px");

        // Tier 2 — drive genuine keyboard focus: Shift+Tab off the target, then
        // Tab back onto it. Focus arrived by keyboard, so the browser deems it
        // :focus-visible and the full 2px ring wins over the hairline. (The
        // gallery registers no focusables, so the walk listener falls through to
        // native Tab order, which returns symmetrically to the target.)
        await app.nativeKey("Tab", ["shift"]);
        await app.waitForCondition<boolean>(
          `(function(){ var t = document.querySelector(${JSON.stringify(DEMO_TARGET)}); return t !== null && !t.contains(document.activeElement); })()`,
          { timeoutMs: 6000 },
        );
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `(function(){ var t = document.querySelector(${JSON.stringify(DEMO_TARGET)}); return t !== null && t.contains(document.activeElement); })()`,
          { timeoutMs: 6000 },
        );
        const tier2 = await app.evalJS<RingProbe>(PROBE(""));
        expect(tier2?.focusVisible).toBe(true);
        expect(tier2?.style).toBe("solid");
        expect(tier2?.width).toBe("2px");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
