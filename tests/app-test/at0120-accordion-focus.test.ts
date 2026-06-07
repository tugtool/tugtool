/**
 * at0120-accordion-focus.test.ts — TugAccordion is a single item-container stop
 * with Enter-descend in the Tug keyboard model ([P01]/[P02]/[P03]).
 *
 * When authored into a `focusGroup`, TugAccordion registers one engine focusable
 * via `useItemGroupKeyboard`: Tab lands the ring on the *accordion* (never a
 * header), a movement cursor (`data-key-cursor`) traverses the headers under
 * Up/Down/Home/End, Space toggles the cursor section, and Enter **descends** into
 * an open section's content (a pushed non-trapped scope). The descended content
 * gets the key view; the accordion gets `data-key-within`; Escape ascends.
 *
 * The gallery `Focus Walk` panel authors a three-section single-mode accordion,
 * fully collapsed; the first section's content holds a navigable inner control.
 * The test proves:
 *   - **Tab → one stop, perimeter ring on the accordion, cursor on the first
 *     header** — the accordion shares TugListView's treatment (row-based
 *     descendable archetype): a ring marks the focused container, the cursor
 *     header carries a tint fill ([P02], rolled out from the list);
 *   - **arrows move the cursor without expanding;**
 *   - **Space expands the cursor section;**
 *   - **Enter descends** into the open section's inner control (key view leaves
 *     the accordion; the accordion shows `data-key-within`), Space acts on it,
 *     and **Escape ascends** back to the accordion (ring returns, within clears).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="accordion-focus-title"]`;
const DEMO = `${CARD} [data-testid="accordion-focus-demo"]`;
const ACC = `${DEMO} [data-slot="tug-accordion"]`;
const HDR_FIRST = `${DEMO} [data-accordion-value="first"]`;
const HDR_SECOND = `${DEMO} [data-accordion-value="second"]`;
const INNER = `${DEMO} [data-testid="accordion-inner-button"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 640 },
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

// The accordion's container perimeter ring + the visible :focus-within mark. As
// a row-based item-group container it wears a ring on its own bounds (matching
// TugListView), not a behind-tint; `data-key-within` is set while a descended
// scope is active.
const ACC_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(ACC)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    backgroundImage: cs.backgroundImage,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    within: el.hasAttribute("data-key-within"),
  };
})()`;

// data-accordion-value of the header currently wearing the movement cursor.
const CURSOR_HEADER = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-accordion-value][data-key-cursor]");
  return el ? el.getAttribute("data-accordion-value") : null;
})()`;

// Per-header snapshot: open/closed state.
const STATE = (selector) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  return el ? el.getAttribute("data-state") : null;
})()`;

// The inner button's key-view marker + click count.
const INNER_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(INNER)});
  if (!el) return null;
  return {
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    count: el.getAttribute("data-count"),
  };
})()`;

interface AccProbe {
  outline: string;
  backgroundImage: string;
  keyboardReached: boolean;
  within: boolean;
}
interface InnerProbe {
  keyboardReached: boolean;
  count: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0120: accordion is a single item-container stop (descend)", () => {
  test(
    "ring on the accordion; arrows move the cursor; Space expands; Enter descends; Escape ascends",
    async () => {
      const app = await launchTugApp({ testName: "at0120-accordion-focus" });
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

        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // (1) Tab → one stop: the perimeter ring lands on the ACCORDION (a
        // row-based item-group container rings its own bounds, matching the list)
        // and the cursor parks on the first header; nothing is expanded.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${CURSOR_HEADER} === "first"`, { timeoutMs: 6000 });
        const onAcc = await app.evalJS<AccProbe>(ACC_PROBE);
        expect(onAcc?.keyboardReached).toBe(true);
        expect(parseFloat(onAcc?.outline ?? "0")).toBeGreaterThan(0);
        expect(await app.evalJS<string>(STATE(HDR_FIRST))).toBe("closed");

        // (2) ArrowDown → cursor moves to `second` without expanding; ArrowUp →
        // back to `first`. The ring stays on the accordion throughout.
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${CURSOR_HEADER} === "second"`, { timeoutMs: 6000 });
        expect(await app.evalJS<string>(STATE(HDR_SECOND))).toBe("closed");
        await app.nativeKey("ArrowUp");
        await app.waitForCondition<boolean>(`${CURSOR_HEADER} === "first"`, { timeoutMs: 6000 });

        // (3) Space → expands the cursor section `first`.
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){var h=document.querySelector(${JSON.stringify(HDR_FIRST)});return h && h.getAttribute("data-state")==="open";})()`,
          { timeoutMs: 6000 },
        );

        // (4) Enter → descends into the open section: the inner control becomes
        // the key view and the accordion shows `data-key-within`.
        await app.nativeKey("Enter");
        await app.waitForCondition<boolean>(
          `(function(){var b=document.querySelector(${JSON.stringify(INNER)});return b && b.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 6000 },
        );
        const descended = await app.evalJS<AccProbe>(ACC_PROBE);
        expect(descended?.within).toBe(true);
        expect(descended?.keyboardReached).toBe(false);

        // (5) Space → acts on the inner control (the counter increments).
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){var b=document.querySelector(${JSON.stringify(INNER)});return b && b.getAttribute("data-count")==="1";})()`,
          { timeoutMs: 6000 },
        );

        // (6) Escape → ascends back to the accordion: the ring returns to the
        // accordion and `data-key-within` clears.
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(
          `(function(){var a=document.querySelector(${JSON.stringify(ACC)});return a && a.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 6000 },
        );
        const ascended = await app.evalJS<AccProbe>(ACC_PROBE);
        expect(ascended?.within).toBe(false);
        const innerAfter = await app.evalJS<InnerProbe>(INNER_PROBE);
        expect(innerAfter?.keyboardReached).toBe(false);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
