/**
 * at0343-prompt-arrow-latch-history.test.ts — the composer's two arrow
 * ergonomics: a plain arrow can neither overshoot into a history recall nor
 * overshoot out of the editor.
 *
 * Two overshoots used to live on the same key. Walking the caret up through a
 * draft handed off to the history provider the moment it reached line one, so
 * the press meant to reach the top replaced the draft instead. This pins the
 * new split end to end on the real Session card:
 *
 *  - plain Up walks the caret and, at the document start, ARMS rather than
 *    leaves — the first press changes nothing and the editor keeps the caret;
 *  - the second discrete Up hands off to the card's focus cycle at the
 *    editor's own seat, so the ring lands on the adjacent cycle stop;
 *  - holding Up (auto-repeat) parks at the edge and never crosses;
 *  - an empty composer needs no latch press — one Up leaves;
 *  - arrowing back onto the editor's stop GRANTS the caret: the stop carries
 *    the editor's focus contract, so landing on it is landing in the editor,
 *    and the blinking caret — never a ring — is the focus indication;
 *  - Cmd-Up away from the start is still `cursorDocStart` and leaves the draft
 *    alone; at the start it recalls the previous entry.
 *
 * Keystrokes are synthetic `keydown`s on the focused element: they travel the
 * identical document-capture pipeline a hardware key does, and CM6's own
 * handlers run on them, which is exactly the seam under test (the pipeline runs
 * before CM6, so which of the two takes a press is the behavior being pinned).
 *
 * @covers tugdeck/src/components/tugways/tug-text-editor/keymap.ts
 * @covers tugdeck/src/components/tugways/tug-text-editor.tsx
 * @covers tugdeck/src/components/tugways/tug-prompt-entry.tsx
 * @covers tugdeck/src/components/tugways/arrow-release.ts
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const ENTRY = `${CARD} .tug-prompt-entry`;
const EDITOR_HOST = `${ENTRY} .tug-text-editor`;
const EDITOR_CONTENT = `${EDITOR_HOST} .cm-content`;
const INPUT_AREA = `${ENTRY} .tug-prompt-entry-input-area`;
const SUBMITTED = "at0343-history-entry";

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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

/** Dispatch a real keydown on the focused element; it travels the document
 *  capture pipeline and CM6's handlers exactly as a hardware key would. */
function pressKey(
  app: App,
  key: string,
  opts: { meta?: boolean; shift?: boolean; repeat?: boolean } = {},
): Promise<null> {
  return app.evalJS<null>(
    `(function(){
      var el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent("keydown", {
        key: ${JSON.stringify(key)},
        metaKey: ${opts.meta === true},
        shiftKey: ${opts.shift === true},
        repeat: ${opts.repeat === true},
        bubbles: true,
        cancelable: true,
      }));
      return null;
    })()`,
  );
}

const CARET_IN_EDITOR = `(function(){
  var el = document.activeElement;
  return el !== null && el.matches(${JSON.stringify(EDITOR_CONTENT)});
})()`;

/** The composer's document, read off CM6's rendered lines. */
function docText(app: App): Promise<string> {
  return app.evalJS<string>(
    `Array.from(document.querySelectorAll(${JSON.stringify(`${EDITOR_CONTENT} .cm-line`)}))
      .map(function(l){ return l.textContent || ""; })
      .join("\\n")`,
  );
}

/**
 * A short address for whichever stop wears the keyboard ring: its authored
 * focus key when it has one, else its class list. (Not every cycle stop
 * carries a focus-key attribute — the PULSE strip's legend, for one — so the
 * class is the reliable identity here.)
 */
function ringAddress(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector('[data-key-view-kbd]');
      if (el === null) return null;
      return el.getAttribute("data-tug-focus-key") || el.className;
    })()`,
  );
}

async function seedCardWithCaret(
  testName: string,
  bind: { tugSessionId: string; projectDir: string } | undefined = undefined,
): Promise<App> {
  const app = await launchTugApp({ testName });
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.bindSession("A", bind);
  await app.awaitEngineReady("A", { timeoutMs: 15_000 });
  await app.nativeClickAtElement(EDITOR_CONTENT);
  await app.waitForCondition<boolean>(CARET_IN_EDITOR, { timeoutMs: 8000 });
  return app;
}

describe.skipIf(!SHOULD_RUN)("at0343 — the composer's arrow latch and Cmd-history", () => {
  test(
    "a plain Up arms before it leaves, a repeat never leaves, and arrowing back grants the caret — never a ring",
    async () => {
      const app = await seedCardWithCaret("at0343-prompt-arrow-latch");
      try {
        // An empty composer has no document to protect, so it pays no latch
        // press: the very first Up leaves.
        await pressKey(app, "ArrowUp");
        await app.waitForCondition<boolean>(`!(${CARET_IN_EDITOR})`, {
          timeoutMs: 3000,
        });

        // Back into the editor, and give it a document to protect.
        await app.nativeClickAtElement(EDITOR_CONTENT);
        await app.waitForCondition<boolean>(CARET_IN_EDITOR, { timeoutMs: 5000 });
        await app.nativeType("alpha");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(EDITOR_CONTENT)}).textContent.indexOf("alpha") !== -1`,
          { timeoutMs: 5000 },
        );

        // Up from the end of a one-line document is a caret key: it lands the
        // caret on the document start and goes no further.
        await pressKey(app, "ArrowUp");
        expect(await app.evalJS<boolean>(CARET_IN_EDITOR)).toBe(true);

        // The first press AT the start arms. It changes nothing visible, which
        // is the honest signal the caret is as far as it goes.
        await pressKey(app, "ArrowUp");
        expect(await app.evalJS<boolean>(CARET_IN_EDITOR)).toBe(true);

        // Holding the key from the armed edge never crosses — the whole point
        // of the discrete-press rule.
        for (let i = 0; i < 4; i += 1) {
          await pressKey(app, "ArrowUp", { repeat: true });
        }
        expect(await app.evalJS<boolean>(CARET_IN_EDITOR)).toBe(true);

        // The next DISCRETE press leaves: the card enters its focus cycle at
        // the editor's own seat and steps off it. The editor blurs — the ring
        // and the caret are never both on the composer.
        await pressKey(app, "ArrowUp");
        await app.waitForCondition<boolean>(`!(${CARET_IN_EDITOR})`, {
          timeoutMs: 3000,
        });
        // The ring is on a stop of the card's cycle — the one adjacent to the
        // editor's seat — and it is not the composer.
        const landed = await ringAddress(app);
        expect(landed).not.toBeNull();
        expect(landed).not.toContain("tug-text-editor");
        expect(landed).not.toContain("tug-prompt-entry-input-area");
        // The draft is untouched: the arrows that armed and crossed spent
        // themselves on movement, never on the document.
        expect(await docText(app)).toBe("alpha");

        // Down comes back onto the editor's stop — the row this phase added to
        // the cycle's grid. The stop carries the editor's focus CONTRACT, so
        // landing on it grants the caret: the editor blinks, no Return needed,
        // and neither the editor nor its input-area wrapper paints a ring.
        await pressKey(app, "ArrowDown");
        await app.waitForCondition<boolean>(CARET_IN_EDITOR, { timeoutMs: 3000 });
        expect(
          await app.evalJS<string>(
            `(function(){
              var out = [];
              for (var sel of [${JSON.stringify(EDITOR_HOST)}, ${JSON.stringify(INPUT_AREA)}]) {
                var el = document.querySelector(sel);
                if (el === null) continue;
                var s = getComputedStyle(el);
                if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) {
                  out.push(sel + " outline=" + s.outline);
                }
                var after = getComputedStyle(el, "::after");
                if (after.content !== "none" && parseFloat(after.borderTopWidth) > 0) {
                  out.push(sel + " ::after border");
                }
              }
              return out.join(" | ");
            })()`,
          ),
        ).toBe("");
        // The draft survived the round trip untouched.
        expect(await docText(app)).toBe("alpha");

        // No arrow in the tour ended with a raw focus write behind the engine.
        const report = await app.evalJS<{
          violations: number;
          steals: Record<string, number>;
        } | null>(`window.__tug.getFocusInvariantReport()`);
        expect(report).not.toBeNull();
        expect(report!.violations).toBe(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "Cmd-Up keeps cursorDocStart away from the edge and recalls history at it",
    async () => {
      const app = await seedCardWithCaret("at0343-prompt-cmd-history");
      try {
        // Submit once so the route's history has an entry to recall. Return
        // inserts a newline in this composer; Shift-Return submits.
        await app.nativeType(SUBMITTED);
        await pressKey(app, "Enter", { shift: true });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(EDITOR_CONTENT)}).textContent.indexOf(${JSON.stringify(SUBMITTED)}) === -1`,
          { timeoutMs: 10_000 },
        );

        // A fresh draft, caret resting at its end — away from the start.
        await app.nativeClickAtElement(EDITOR_CONTENT);
        await app.waitForCondition<boolean>(CARET_IN_EDITOR, { timeoutMs: 5000 });
        await app.nativeType("draft line");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(EDITOR_CONTENT)}).textContent === "draft line"`,
          { timeoutMs: 5000 },
        );

        // Cmd-Up away from the start keeps its editing function: it jumps the
        // caret to the document start and leaves the draft alone.
        await pressKey(app, "ArrowUp", { meta: true });
        await new Promise<void>((r) => setTimeout(r, 300));
        expect(await docText(app)).toBe("draft line");

        // At the start that function is already a no-op, so Cmd-Up now recalls.
        await pressKey(app, "ArrowUp", { meta: true });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(EDITOR_CONTENT)}).textContent.indexOf("at0343-history") !== -1`,
          { timeoutMs: 5000 },
        );

        // A plain Up at the start never recalls: it arms, and the text stays.
        const recalled = await docText(app);
        await pressKey(app, "ArrowUp");
        await new Promise<void>((r) => setTimeout(r, 300));
        expect(await docText(app)).toBe(recalled);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
