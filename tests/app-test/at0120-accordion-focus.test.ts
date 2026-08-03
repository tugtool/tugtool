/**
 * at0120-accordion-focus.test.ts — TugAccordion is a single item-container stop
 * with Enter-descend in the Tug keyboard model ([P01]/[P02]/[P03]).
 *
 * When authored into a `focusGroup`, TugAccordion registers one engine focusable
 * via `useItemGroupKeyboard`: Tab lands the key view on the *accordion* (never a
 * header), a movement cursor (`data-key-cursor`) traverses the headers under
 * Up/Down/Home/End, Space toggles the cursor section, and Enter **descends** into
 * an open section's content (a pushed non-trapped scope). The descended content
 * gets the key view; the accordion gets `data-key-within`; Escape ascends.
 *
 * The gallery `Focus Walk` panel authors a three-section single-mode accordion,
 * fully collapsed; the first section's content holds a navigable inner control.
 * The test proves:
 *   - **Tab → one stop, container wash on the accordion, cursor bar on the
 *     first header** — the accordion shares TugListView's treatment (row-based
 *     descendable archetype), and shares its vocabulary: rings mark elements,
 *     washes mark containers, so the accordion paints a background wash and no
 *     stroke, and the cursor header carries a leading-edge bar;
 *   - **arrows move the cursor without expanding;**
 *   - **Space expands the cursor section;**
 *   - **Enter descends** into the open section's inner control (key view leaves
 *     the accordion; the accordion shows `data-key-within`), Space acts on it,
 *     and **Escape ascends** back to the accordion (key view returns, within clears).
 *
 * @covers tugdeck/src/components/tugways/tug-accordion.tsx
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/styles/focus-ring.css
 * @covers tugdeck/src/components/tugways/cards/gallery-accordion.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import { appIsActive, keyboardIsInCard } from "./_harness/selectors";

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
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

// The accordion's container mark + the visible :focus-within mark. Rings mark
// elements, washes mark containers: as an item-group container it paints a
// background wash on its own bounds and no stroke of any kind, matching
// TugListView. `data-key-within` is set while a descended scope is active, and
// the accordion keeps the FULL wash for it — a descend goes deeper into the
// group rather than out of it.
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

// The cursor trigger's element-level mark: a leading-edge bar drawn as a
// `::before`, the same mark TugListView puts on its cursor row. Reads the bar's
// width and paint rather than merely asserting the pseudo exists, so a rule that
// generated an invisible zero-width bar would fail.
const CURSOR_BAR = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-accordion-value][data-key-cursor]");
  if (!el) return null;
  var cs = getComputedStyle(el, "::before");
  return { width: cs.width, background: cs.backgroundColor, content: cs.content };
})()`;

// data-accordion-value of the header currently wearing the movement cursor.
const CURSOR_HEADER = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-accordion-value][data-key-cursor]");
  return el ? el.getAttribute("data-accordion-value") : null;
})()`;

// Per-header snapshot: open/closed state.
const STATE = (selector: string) => `(function(){
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
interface CursorBar {
  width: string;
  background: string;
  content: string;
}
interface InnerProbe {
  keyboardReached: boolean;
  count: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0120: accordion is a single item-container stop (descend)", () => {
  test(
    "wash on the accordion; arrows move the cursor; Space expands; Enter descends; Escape ascends",
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
        // Activate the webview, then gate on the app-active projection — the bit
        // `focus-ring.css` suppresses every focus mark under. NOT
        // `document.hasFocus()`: a background-mode harness window never
        // activates, so that never becomes true (see `appIsActive`).
        await app.waitForCondition<boolean>(appIsActive(), { timeoutMs: 6000 });
        // The click activates the card; the Tab below is only meaningful once
        // that activation has settled the keyboard into the card. Waiting on
        // the engine fact rather than a fixed delay keeps the first key from
        // racing the activation transfer when the machine is loaded — a bare
        // sleep here is what made this file order-sensitive in large batches.
        await app.waitForCondition<boolean>(keyboardIsInCard("A"), { timeoutMs: 6000 });

        // (1) Tab → one stop: the container WASH lands on the ACCORDION (a
        // row-based item-group container marks its own bounds with a background
        // layer, matching the list) and the cursor parks on the first header;
        // nothing is expanded. The `outlineWidth === "0px"` half is the load-
        // bearing one — a container that both washed and ringed would be the
        // nested-marks conflation this treatment exists to retire.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${CURSOR_HEADER} === "first"`, { timeoutMs: 6000 });
        const onAcc = await app.evalJS<AccProbe>(ACC_PROBE);
        expect(onAcc?.keyboardReached).toBe(true);
        expect(onAcc?.outline).toBe("0px");
        expect(onAcc?.backgroundImage).not.toBe("none");
        expect(await app.evalJS<string>(STATE(HDR_FIRST))).toBe("closed");

        // (1b) The cursor trigger wears the leading-edge BAR — the element-level
        // mark, the same one TugListView draws on its cursor row. The accordion
        // and the list agree by construction here (both read the language-level
        // `--tugx-focus-cursor-bar-*` knobs) rather than by eye.
        const bar = await app.evalJS<CursorBar>(CURSOR_BAR);
        expect(bar?.content).not.toBe("none");
        expect(parseFloat(bar?.width ?? "0")).toBeGreaterThan(0);
        expect(bar?.background).not.toBe("rgba(0, 0, 0, 0)");

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

        // (6) Escape → ascends back to the accordion: the key view returns to
        // the accordion and `data-key-within` clears.
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(
          `(function(){var a=document.querySelector(${JSON.stringify(ACC)});return a && a.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 6000 },
        );
        const ascended = await app.evalJS<AccProbe>(ACC_PROBE);
        expect(ascended?.within).toBe(false);
        const innerAfter = await app.evalJS<InnerProbe>(INNER_PROBE);
        expect(innerAfter?.keyboardReached).toBe(false);

        // (7) Right also descends (tree disclosure convention): the cursor
        // section `first` is still open + has content, so ArrowRight enters it
        // like Enter — the inner control becomes the key view again.
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){var b=document.querySelector(${JSON.stringify(INNER)});return b && b.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 6000 },
        );
        const reDescended = await app.evalJS<AccProbe>(ACC_PROBE);
        expect(reDescended?.within).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
