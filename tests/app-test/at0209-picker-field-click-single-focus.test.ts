/**
 * at0209-picker-field-click-single-focus.test.ts — clicking the picker's path
 * combo box is a SINGLE focus authority ([P13] one ring, ever).
 *
 * ## The repro this gates
 *
 * The "Choose Session" sheet is portaled OUTSIDE any `[data-card-id]` subtree, so
 * the document-level pointer promotion (`placeFromPointer`, which resolves the
 * target card via `closest([data-card-id])`) bails inside it. Without a fix, a
 * click on the path field takes DOM focus while the engine key view stays on
 * whatever it last placed (the sessions list) — two focus rings at once, the
 * exact "both lists focused" bug. The combo box now promotes itself to the key
 * view on pointer-down (by its own registered id, needing no card ancestor), so
 * a click moves the ring to the field and the sessions list yields it.
 *
 * Verified with a REAL native click (the synthetic-focus path doesn't exercise
 * the document pointer pipeline).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const PATH = '[data-tug-focus-key="session-picker-cycle:0"]';
const SESSIONS = '[data-tug-focus-key="session-picker-cycle:2"]';
const PICKER_FORM = ".session-card-picker-form";
const SEED_RECENTS = ["/", "/tmp", "/usr"];

const PICKER_OPEN = `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`;

// The count of elements wearing the keyboard ring, the field's DOM focus, and
// whether the sessions list still wears the ring.
const FOCUS_STATE = `(function(){
  var input = document.querySelector(${JSON.stringify(PATH)});
  var sessions = document.querySelector(${JSON.stringify(SESSIONS)});
  return {
    ringCount: document.querySelectorAll("[data-key-view-kbd]").length,
    inputIsFocus: input ? input.matches(":focus") : false,
    sessionsHasRing: sessions ? sessions.hasAttribute("data-key-view-kbd") : false,
  };
})()`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 600 },
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

describe.skipIf(!SHOULD_RUN)("AT0209: clicking the picker path field is a single focus authority", () => {
  test(
    "a click moves the ring to the field; the sessions list never keeps a second ring",
    async () => {
      const app = await launchTugApp({ testName: "at0209-picker-field-click-single-focus" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(PICKER_OPEN, { timeoutMs: 8000 });
        await app.evalJS<null>(
          `(window.__tug.setTugbankValue(${JSON.stringify("dev.tugtool.dev")}, ${JSON.stringify("recent-projects")}, { kind: "json", value: { paths: ${JSON.stringify(SEED_RECENTS)} } }), null)`,
        );
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(PATH)}); return el !== null && el.value.length > 0; })()`,
          { timeoutMs: 8000 },
        );
        // Seed lands the ring on the Sessions list ([P12]).
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SESSIONS)})?.hasAttribute("data-key-view-kbd") === true`,
          { timeoutMs: 8000 },
        );
        // At rest: exactly one ring, on the Sessions list; the field is not focused.
        expect(
          await app.evalJS<{ ringCount: number; inputIsFocus: boolean; sessionsHasRing: boolean }>(FOCUS_STATE),
        ).toEqual({
          ringCount: 1,
          inputIsFocus: false,
          sessionsHasRing: true,
        });

        // A real click on the path field promotes it: the field takes focus and
        // the Sessions list yields its ring — never two rings at once.
        await app.nativeClickAtElement(".session-card-picker-form input");
        await app.waitForCondition<boolean>(
          `${FOCUS_STATE}.inputIsFocus === true`,
          { timeoutMs: 6000 },
        );
        const after = await app.evalJS<{ ringCount: number; sessionsHasRing: boolean }>(FOCUS_STATE);
        expect(after.sessionsHasRing, "the sessions list must not keep a second ring after the field is clicked").toBe(false);
        // A pointer click grants a caret, not a keyboard ring — so zero keyboard
        // rings, never two.
        expect(after.ringCount).toBeLessThanOrEqual(1);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
