/**
 * at0119-option-group-focus.test.ts — TugOptionGroup is a single item-container
 * stop in the Tug keyboard model ([P01]/[P03]).
 *
 * The option group registers one focusable for the whole group ([P02]) via
 * `useItemGroupKeyboard`: Tab lands the ring on the *group* (never on an item),
 * a movement cursor (`data-key-cursor`) traverses the items under the arrows,
 * and Space toggles the cursor item — focus is **separate** from selection here
 * (multi-select). Tab-into lands the cursor on the first item.
 *
 * The gallery `Focus Walk` panel authors a three-item group (nothing toggled).
 * The test proves the **item-group focus treatment** ([P02] of the
 * focus-language plan): the group is one stop, but the ring does NOT wrap the
 * container — the container carries a faint behind-tint and the *cursor item*
 * carries the single ring (which is what lets multi-select read atop an on-fill
 * without an added checkmark).
 *   - **Tab → one stop; behind-tint on the group, NOT a ring; ring on the
 *     cursor item:** Tab marks the group key-view, paints the behind-tint on the
 *     container (its outline stays 0 — no container ring), and parks the ring on
 *     the cursor item `alpha`;
 *   - **arrows move the cursor + its ring without selecting:** ArrowDown moves
 *     the cursor (and ring) to `beta`; `beta` stays `data-state="off"`, the group
 *     keeps the key view;
 *   - **Space toggles the cursor item:** Space turns `beta` on (`data-state="on"`).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="option-focus-title"]`;
const DEMO = `${CARD} [data-testid="option-focus-demo"]`;
const GROUP = `${DEMO} [data-slot="tug-option-group"]`;
const OPT_ALPHA = `${DEMO} [data-option-value="alpha"]`;
const OPT_BETA = `${DEMO} [data-option-value="beta"]`;

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

// The group container's focus marks ([P02]): the item-group model gives the
// container a behind-tint, NOT a ring — `outline` stays 0 while `backgroundImage`
// carries the tint gradient when the group holds the key view.
const GROUP_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(GROUP)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    behindTint: cs.backgroundImage,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
  };
})()`;

// data-option-value of the item currently wearing the movement cursor, or null.
const CURSOR_OPTION = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-option-value][data-key-cursor]");
  return el ? el.getAttribute("data-option-value") : null;
})()`;

// The outline width of the cursor item — the single ring of the item-group
// model lives here, not on the container; it must read even atop an on-fill.
const CURSOR_RING_WIDTH = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-option-value][data-key-cursor]");
  return el ? getComputedStyle(el).outlineWidth : null;
})()`;

// Per-item snapshot: cursor + on/off state + aria-pressed.
const PROBE = (selector) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  return {
    cursor: el.hasAttribute("data-key-cursor"),
    state: el.getAttribute("data-state"),
    pressed: el.getAttribute("aria-pressed"),
  };
})()`;

interface GroupProbe {
  outline: string;
  behindTint: string;
  keyboardReached: boolean;
}
interface OptionProbe {
  cursor: boolean;
  state: string | null;
  pressed: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0119: option group is a single item-container stop", () => {
  test(
    "Tab rings the group + cursors the first item; arrows move the cursor without selecting; Space toggles",
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

        // (1) Tab → one stop with the item-group treatment: the GROUP holds the
        // key view and paints the behind-tint but NOT a ring (outline stays 0 —
        // the double-ring guard), and the single ring lands on the cursor item
        // `alpha`.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${CURSOR_OPTION} === "alpha"`, { timeoutMs: 6000 });
        const onGroup = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(onGroup?.keyboardReached).toBe(true);
        expect(parseFloat(onGroup?.outline ?? "0")).toBe(0);
        expect(onGroup?.behindTint.startsWith("linear-gradient")).toBe(true);
        const cursorRingOnAlpha = await app.evalJS<string | null>(CURSOR_RING_WIDTH);
        expect(parseFloat(cursorRingOnAlpha ?? "0")).toBeGreaterThan(0);

        // (2) ArrowDown → the cursor (and its ring) move to `beta`; selection does
        // NOT follow (multi-select: cursor is separate from selection), group keeps
        // the key view with its behind-tint (still no container ring).
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${CURSOR_OPTION} === "beta"`, { timeoutMs: 6000 });
        const onBeta = await app.evalJS<OptionProbe>(PROBE(OPT_BETA));
        expect(onBeta?.state).toBe("off");
        const alphaAfter = await app.evalJS<OptionProbe>(PROBE(OPT_ALPHA));
        expect(alphaAfter?.cursor).toBe(false);
        const ringStill = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(ringStill?.keyboardReached).toBe(true);
        expect(parseFloat(ringStill?.outline ?? "0")).toBe(0);
        const cursorRingOnBeta = await app.evalJS<string | null>(CURSOR_RING_WIDTH);
        expect(parseFloat(cursorRingOnBeta ?? "0")).toBeGreaterThan(0);

        // (3) Space → toggles the cursor item (beta) on; the cursor stays on beta.
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(OPT_BETA)}); return el && el.getAttribute("data-state") === "on"; })()`,
          { timeoutMs: 6000 },
        );
        const betaToggled = await app.evalJS<OptionProbe>(PROBE(OPT_BETA));
        expect(betaToggled?.state).toBe("on");
        expect(betaToggled?.pressed).toBe("true");
        expect(betaToggled?.cursor).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
