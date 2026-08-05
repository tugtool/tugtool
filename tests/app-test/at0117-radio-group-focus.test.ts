/**
 * at0117-radio-group-focus.test.ts — TugRadioGroup is a single item-container
 * stop in the Tug keyboard model ([P01]/[P03]).
 *
 * The radio group (no Radix) registers one focusable for the whole group
 * ([P02]) via `useItemGroupKeyboard`: Tab lands the ring on the *group* (never
 * on a member), and the group uses **explicit commit** ([P24]) — the arrows move
 * the cursor (`data-key-cursor`) and its ring WITHOUT changing the selection, and
 * **Space** commits the ringed item. This reverts the 7.7-era
 * selection-follows-cursor: arrows are a pure ring-mover, the commit is a separate
 * act. The group does NOT consume Enter (it bubbles to the scope default);
 * Tab-into lands the cursor on the checked item.
 *
 * The gallery `Focus Walk` panel authors a three-item group (value `a` checked).
 * The test proves the **item-group focus treatment** ([P02] of the
 * focus-language plan): the group is one stop, and the container ring that
 * wraps it is NOT the leaf ring — it is the toned container token, worn a step
 * thicker than the full-accent ring on the *cursor item* inside it.
 *   - **no ring / no tint at rest:** before keyboard focus the group has no
 *     ring and no behind-tint;
 *   - **Tab → one stop; toned ring on the group, full-accent ring on the
 *     cursor item:** Tab marks the group key-view, rings the container with the
 *     toned CONTAINER ring, and parks the element ring on the cursor item `a`.
 *     Both are strokes, so the suite asserts the WEIGHT GAP between them — the
 *     container strictly thicker — which is all that keeps them legible as two
 *     marks. (Guards against the container being repointed at the leaf token.)
 *   - **arrows move the ring WITHOUT committing ([P24]):** ArrowDown moves the
 *     cursor (and the ring) to `b` while `a` stays checked and `b` stays unchecked
 *     — no selection change. **Space** then commits `b` (checks `b`, unchecks
 *     `a`). ArrowUp moves the ring back to `a` without changing the selection;
 *     Space commits `a`. The group keeps the key view + container ring
 *     throughout.
 *
 * @covers tugdeck/src/components/tugways/tug-radio-group.tsx
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/styles/focus-ring.css
 * @covers tugdeck/src/components/tugways/cards/gallery-radio-group.tsx
 * @covers tugdeck/src/components/tugways/tug-radio-group.css
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import { appIsActive } from "./_harness/selectors";

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
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

// The group container's focus marks ([P02]): under the item-group model it
// wears the toned CONTAINER ring — so `outline` carries a width while
// `backgroundImage` stays "none" (the wash that used to live there is gone).
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

        // Activate the webview, then gate on the app-active projection — the bit
        // `focus-ring.css` suppresses every focus mark under. NOT
        // `document.hasFocus()`: a background-mode harness window never
        // activates, so that never becomes true (see `appIsActive`).
        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(appIsActive(), { timeoutMs: 6000 });
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
        // key view and wears the toned CONTAINER ring, and the cursor item `a`
        // wears the full-accent element ring inside it.
        //
        // Both marks are strokes now, so "they are two marks" is no longer
        // self-evident from one being an area — it rests entirely on the WEIGHT
        // GAP, and that is what gets asserted. The container's stroke must be
        // strictly thicker than the cursor's. If a future edit points the
        // container back at `--tugx-focus-ring` (the leaf token) the two widths
        // collapse to equal and this fails, which is the regression worth
        // catching: the nested-marks conflation returns the moment they read
        // alike. The container also paints NO background layer — it used to
        // wear a wash there, and a container doing both would be marking twice.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${CURSOR_RADIO} === "a"`, { timeoutMs: 6000 });
        const onGroup = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(onGroup?.keyboardReached).toBe(true);
        expect(parseFloat(onGroup?.outline ?? "0")).toBeGreaterThan(0);
        expect(onGroup?.behindTint).toBe("none");
        const cursorRingOnA = await app.evalJS<string | null>(CURSOR_RING_WIDTH);
        expect(parseFloat(cursorRingOnA ?? "0")).toBeGreaterThan(0);
        expect(parseFloat(onGroup?.outline ?? "0")).toBeGreaterThan(
          parseFloat(cursorRingOnA ?? "0"),
        );

        // (3) ArrowDown → the cursor (and its ring) move to `b`, but the selection
        // does NOT follow ([P24]): `a` stays checked and `b` stays unchecked. The
        // group keeps the key view and its container ring — the cursor moving
        // within a group never changes which container holds the keyboard.
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${CURSOR_RADIO} === "b"`, { timeoutMs: 6000 });
        const aAfterMove = await app.evalJS<ItemProbe>(PROBE(RADIO_A));
        expect(aAfterMove?.cursor).toBe(false);
        expect(aAfterMove?.state).toBe("checked"); // selection unchanged by the arrow
        const bAfterMove = await app.evalJS<ItemProbe>(PROBE(RADIO_B));
        expect(bAfterMove?.state).toBe("unchecked"); // ringed but not committed
        const ringStill = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(ringStill?.keyboardReached).toBe(true);
        expect(parseFloat(ringStill?.outline ?? "0")).toBeGreaterThan(0);
        const cursorRingOnB = await app.evalJS<string | null>(CURSOR_RING_WIDTH);
        expect(parseFloat(cursorRingOnB ?? "0")).toBeGreaterThan(0);

        // (3b) Space → commits the ringed item `b` (checks `b`, unchecks `a`).
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){var b=document.querySelector(${JSON.stringify(RADIO_B)});return b && b.getAttribute("data-state")==="checked";})()`,
          { timeoutMs: 6000 },
        );
        const aAfterCommit = await app.evalJS<ItemProbe>(PROBE(RADIO_A));
        expect(aAfterCommit?.state).toBe("unchecked");

        // (4) ArrowUp → the ring moves back to `a` without changing the selection
        // (`b` stays checked); Space then commits `a`.
        await app.nativeKey("ArrowUp");
        await app.waitForCondition<boolean>(`${CURSOR_RADIO} === "a"`, { timeoutMs: 6000 });
        const bStillChecked = await app.evalJS<ItemProbe>(PROBE(RADIO_B));
        expect(bStillChecked?.state).toBe("checked"); // selection unchanged by the arrow
        await app.nativeKey(" ");
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
