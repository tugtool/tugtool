/**
 * at0117-radio-group-focus.test.ts — TugRadioGroup is a single item-container
 * stop in the Tug keyboard model ([P01]/[P03]).
 *
 * The radio group (no Radix) registers one focusable for the whole group
 * ([P02]) via `useItemGroupKeyboard`: Tab lands the ring on the *group* (never
 * on a member), and the group is **selection-follows-cursor** ([Q06]) — the
 * arrows move the cursor (`data-key-cursor`) AND the selection together, so a
 * mutually-exclusive radio is always in a settled state (no
 * highlighted-but-uncommitted limbo). The group does NOT consume Enter; Tab-into
 * lands the cursor on the checked item.
 *
 * The gallery `Focus Walk` panel authors a three-item group (value `a` checked).
 * The test proves the **item-group focus treatment** ([P02] of the
 * focus-language plan): the group is one stop, but the ring does NOT wrap the
 * container — the container carries a faint behind-tint and the *cursor item*
 * carries the single ring. This is the inversion [#step-3] lands; the prior
 * model rang the whole container.
 *   - **no ring / no tint at rest:** before keyboard focus the group has no
 *     ring and no behind-tint;
 *   - **Tab → one stop; behind-tint on the group, NOT a ring; ring on the
 *     cursor item:** Tab marks the group key-view, paints the behind-tint on the
 *     container (its outline stays 0 — no container ring), and parks the ring on
 *     the cursor item `a`. (Guards against the container double-ring regression.)
 *   - **arrows move the selection immediately (selection follows cursor):**
 *     ArrowDown moves the cursor (and the ring) to `b` AND checks `b` (unchecks
 *     `a`) in one keystroke — no Space confirm; ArrowUp moves back and re-checks
 *     `a`. The group keeps the key view + behind-tint throughout (no container
 *     ring).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="radio-focus-title"]`;
const DEMO = `${CARD} [data-testid="radio-focus-demo"]`;
const GROUP = `${DEMO} [data-slot="tug-radio-group"]`;
const RADIO_A = `${DEMO} [data-radio-value="a"]`;
const RADIO_B = `${DEMO} [data-radio-value="b"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-radio-group", title: "Radio", closable: true }],
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

// The group container's focus marks ([P02]): under the item-group model it gets
// a behind-tint, NOT a ring — so `outline` must stay 0 while `backgroundImage`
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

// data-radio-value of the item currently wearing the movement cursor, or null.
const CURSOR_RADIO = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-radio-value][data-key-cursor]");
  return el ? el.getAttribute("data-radio-value") : null;
})()`;

// The outline width of the item currently wearing the cursor — the single ring
// of the item-group model lives HERE, not on the container.
const CURSOR_RING_WIDTH = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-radio-value][data-key-cursor]");
  return el ? getComputedStyle(el).outlineWidth : null;
})()`;

// Per-item snapshot: cursor + checked state.
const PROBE = (selector: string) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  return {
    cursor: el.hasAttribute("data-key-cursor"),
    state: el.getAttribute("data-state"),
  };
})()`;

interface GroupProbe {
  outline: string;
  behindTint: string;
  keyboardReached: boolean;
}
interface ItemProbe {
  cursor: boolean;
  state: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0117: radio group is a single item-container stop", () => {
  test(
    "no ring at rest; Tab rings the group + cursors the checked item; arrows move the cursor; Space commits",
    async () => {
      const app = await launchTugApp({ testName: "at0117-radio-group-focus" });
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
        // before driving Tab (this card is heavier to settle than a fixed delay).
        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // (1) At rest: no key view, no container ring, no behind-tint; `a` is
        // the checked item.
        const atRest = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(atRest?.keyboardReached).toBe(false);
        expect(parseFloat(atRest?.outline ?? "0")).toBe(0);
        expect(atRest?.behindTint).toBe("none");
        const aRest = await app.evalJS<ItemProbe>(PROBE(RADIO_A));
        expect(aRest?.state).toBe("checked");

        // (2) Tab → one stop with the item-group treatment: the GROUP holds the
        // key view and paints the behind-tint but NOT a ring (outline stays 0 —
        // the double-ring guard), and the single ring lands on the cursor item
        // `a`.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${CURSOR_RADIO} === "a"`, { timeoutMs: 6000 });
        const onGroup = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(onGroup?.keyboardReached).toBe(true);
        expect(parseFloat(onGroup?.outline ?? "0")).toBe(0);
        expect(onGroup?.behindTint.startsWith("linear-gradient")).toBe(true);
        const cursorRingOnA = await app.evalJS<string | null>(CURSOR_RING_WIDTH);
        expect(parseFloat(cursorRingOnA ?? "0")).toBeGreaterThan(0);

        // (3) ArrowDown → selection follows the cursor IMMEDIATELY ([Q06]): the
        // cursor (and its ring) move to `b` AND `b` becomes checked while `a`
        // unchecks — no Space confirm. The group keeps the key view + behind-tint
        // (still no container ring).
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${CURSOR_RADIO} === "b"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(
          `(function(){var b=document.querySelector(${JSON.stringify(RADIO_B)});return b && b.getAttribute("data-state")==="checked";})()`,
          { timeoutMs: 6000 },
        );
        const aAfterMove = await app.evalJS<ItemProbe>(PROBE(RADIO_A));
        expect(aAfterMove?.cursor).toBe(false);
        expect(aAfterMove?.state).toBe("unchecked");
        const ringStill = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(ringStill?.keyboardReached).toBe(true);
        expect(parseFloat(ringStill?.outline ?? "0")).toBe(0);
        const cursorRingOnB = await app.evalJS<string | null>(CURSOR_RING_WIDTH);
        expect(parseFloat(cursorRingOnB ?? "0")).toBeGreaterThan(0);

        // (4) ArrowUp → selection follows the cursor back to `a` (re-checks `a`,
        // unchecks `b`) — proving live commit in both directions.
        await app.nativeKey("ArrowUp");
        await app.waitForCondition<boolean>(`${CURSOR_RADIO} === "a"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(
          `(function(){var a=document.querySelector(${JSON.stringify(RADIO_A)});return a && a.getAttribute("data-state")==="checked";})()`,
          { timeoutMs: 6000 },
        );
        const bFinal = await app.evalJS<ItemProbe>(PROBE(RADIO_B));
        expect(bFinal?.state).toBe("unchecked");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
