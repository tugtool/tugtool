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
 * The test proves:
 *   - **Tab → one stop, ring on the group, cursor on the first item:** Tab
 *     rings the group and parks the cursor on `alpha`;
 *   - **arrows move the cursor without selecting:** ArrowDown moves the cursor
 *     to `beta`; `beta` is still `data-state="off"`, the ring stays on the group;
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

// The group's ring marker + outline (the ring is on the component, [P03]).
const GROUP_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(GROUP)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
  };
})()`;

// data-option-value of the item currently wearing the movement cursor, or null.
const CURSOR_OPTION = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-option-value][data-key-cursor]");
  return el ? el.getAttribute("data-option-value") : null;
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

        // (1) Tab → one stop: the ring lands on the GROUP and the cursor parks
        // on the first item `alpha`.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${CURSOR_OPTION} === "alpha"`, { timeoutMs: 6000 });
        const onGroup = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(onGroup?.keyboardReached).toBe(true);
        expect(parseFloat(onGroup?.outline ?? "0")).toBeGreaterThan(0);

        // (2) ArrowDown → the cursor moves to `beta`; selection does NOT follow
        // (multi-select: cursor is separate from selection), ring stays on group.
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${CURSOR_OPTION} === "beta"`, { timeoutMs: 6000 });
        const onBeta = await app.evalJS<OptionProbe>(PROBE(OPT_BETA));
        expect(onBeta?.state).toBe("off");
        const alphaAfter = await app.evalJS<OptionProbe>(PROBE(OPT_ALPHA));
        expect(alphaAfter?.cursor).toBe(false);
        const ringStill = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(ringStill?.keyboardReached).toBe(true);

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
