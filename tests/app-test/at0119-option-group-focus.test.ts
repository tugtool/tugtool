/**
 * at0119-option-group-focus.test.ts — TugOptionGroup is a single roving stop.
 *
 * The option group registers one focusable for the whole group ([P02]) via
 * `useRovingFocusable`: Tab lands the key view on the focused item, arrows rove
 * focus between items locally, and Space/Enter toggles the focused item — focus
 * is **separate** from selection here (multi-select). The ring follows the
 * arrows (`refreshKeyViewProjection`) and is driven by `data-key-view-kbd`
 * alone ([P05]).
 *
 * The gallery `Focus Walk` panel authors a three-item group (nothing toggled).
 * The test proves:
 *   - **Tab → one stop, ring on the focused item:** Tab lands the key view on
 *     `alpha` and rings it;
 *   - **arrows rove without selecting:** ArrowDown moves the ring to `beta` and
 *     clears it from `alpha`; `beta` is focused but still `data-state="off"`;
 *   - **Space toggles the focused item:** Space turns `beta` on
 *     (`data-state="on"`) while the ring stays on `beta`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="option-focus-title"]`;
const OPT_ALPHA = `${CARD} [data-testid="option-focus-demo"] [data-option-value="alpha"]`;
const OPT_BETA = `${CARD} [data-testid="option-focus-demo"] [data-option-value="beta"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-option-group", title: "Option", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 620 },
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

// data-option-value of the item currently carrying the key view, or null.
const KEY_VIEW_OPTION = `(function(){
  var el = document.querySelector("[data-option-value][data-key-view]");
  return el ? el.getAttribute("data-option-value") : null;
})()`;

// Per-item snapshot: ring + keyboard marker + on/off state + tab stop.
const PROBE = (selector) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    state: el.getAttribute("data-state"),
    pressed: el.getAttribute("aria-pressed"),
    tabIndex: el.getAttribute("tabindex"),
  };
})()`;

interface OptionProbe {
  outline: string;
  keyboardReached: boolean;
  state: string | null;
  pressed: string | null;
  tabIndex: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0119: option group is a single roving stop", () => {
  test(
    "Tab rings the focused item; arrows rove without selecting; Space toggles",
    async () => {
      const app = await launchTugApp({ testName: "at0119-option-group-focus" });
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

        // Activate the webview and wait until the document holds key focus
        // before driving Tab.
        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // (1) Tab → the group is one stop: the key view lands on the focused
        // item (first enabled = alpha) and the ring paints there.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_OPTION} === "alpha"`, { timeoutMs: 6000 });
        const onAlpha = await app.evalJS<OptionProbe>(PROBE(OPT_ALPHA));
        expect(onAlpha?.keyboardReached).toBe(true);
        expect(parseFloat(onAlpha?.outline ?? "0")).toBeGreaterThan(0);
        expect(onAlpha?.tabIndex).toBe("0");

        // (2) ArrowDown → roves focus to beta; the ring follows but selection
        // does NOT (multi-select: focus is separate from selection).
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${KEY_VIEW_OPTION} === "beta"`, { timeoutMs: 6000 });
        const onBeta = await app.evalJS<OptionProbe>(PROBE(OPT_BETA));
        expect(onBeta?.keyboardReached).toBe(true);
        expect(parseFloat(onBeta?.outline ?? "0")).toBeGreaterThan(0);
        expect(onBeta?.state).toBe("off");
        const alphaAfter = await app.evalJS<OptionProbe>(PROBE(OPT_ALPHA));
        expect(alphaAfter?.keyboardReached).toBe(false);

        // (3) Space → toggles the focused item (beta) on; the ring stays on beta.
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(OPT_BETA)}); return el && el.getAttribute("data-state") === "on"; })()`,
          { timeoutMs: 6000 },
        );
        const betaToggled = await app.evalJS<OptionProbe>(PROBE(OPT_BETA));
        expect(betaToggled?.state).toBe("on");
        expect(betaToggled?.pressed).toBe("true");
        expect(betaToggled?.keyboardReached).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
