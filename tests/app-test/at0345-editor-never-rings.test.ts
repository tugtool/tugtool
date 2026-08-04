/**
 * at0345-editor-never-rings.test.ts — a text editor never wears a focus ring.
 *
 * ## Why this exists
 *
 * The blinking caret is a full carrier of keyboard focus, not a hint that wants
 * a ring's help. An editor holding the keyboard blinks, and that is the whole
 * signal — a ring drawn on or around an editor is an **illegal state by
 * design**, not a harmless redundancy. There is no keyboard state of an editor
 * without the caret: an editor's cycle stop carries the editor's own focus
 * contract, so every traversal that lands on it grants the caret.
 *
 * This kept being re-broken from opposite directions — first a rule that ringed
 * any editor authored into a focus group (which lit the ⌘F query field the
 * instant the caret landed in it), then a well-meant "embedded editors get no
 * ring at all, let's give them one" fix. A convention that two changes in a row
 * violated is not a convention, so this is the invariant as a test: sweep the
 * deck, in every state that lands the keyboard in an editor, and assert that no
 * `.tug-text-editor` anywhere computes a visible outline.
 *
 * ## Test matrix
 *
 *   1. Caret clicked into the composer.
 *   2. Caret in the ⌘F query field — two editors mounted, one of them live.
 *   3. Caret in the composer with the find bar still open — the other way round.
 *   4. The **cycling stop**: ⌥⇥ walked round the card's cycle to the composer's
 *      text stop. The stop registers under the editor's own responder id, so it
 *      carries the editor's focus contract and landing on it GRANTS the caret —
 *      there is no blurred parked state left for a ring (or an invisible wash)
 *      to mark. This is the state the ring survived longest in — a click never
 *      reaches it, so the first three cases all passed while the input-area
 *      wrapper still drew an orange rectangle around the composer.
 *
 * In each: nothing on the card draws a ring around editor text, and the editor
 * holding the keyboard really is holding it, so the assertion is "no ring" and
 * not merely "nothing has focus".
 *
 * @covers tugdeck/src/components/tugways/tug-text-editor.css
 * @covers tugdeck/src/components/tugways/tug-entry-shell.css
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;
const FEED_CODE_OUTPUT = 0x40;
const SID = "c7c0d1ea-0000-4000-8000-000000000346";
/** Upper bound on Tabs to walk the card cycle round to the editor text stop. */
const CYCLE_STOP_LIMIT = 24;

const CARD = '[data-card-id="A"]';
const EDITOR = `${CARD} [data-slot="tug-prompt-entry"] [data-slot="tug-text-editor"] .cm-content`;
const FIND_BAR = `${CARD} [data-slot="session-card-find-bar"]`;
const FIND_INPUT = `${FIND_BAR} [data-testid="session-card-find-input"] .cm-content`;

/**
 * Every editor host on the card that computes a visible ring — and every
 * wrapper that draws one AROUND an editor, which to the eye is the same ring.
 * The distinction between "the editor" and "the box the editor fills" is a DOM
 * detail; a user sees one orange rectangle around their text either way.
 */
const RINGED_EDITORS = `(() => {
  const out = [];
  const hosts = [
    ...document.querySelectorAll('${CARD} .tug-text-editor'),
    ...document.querySelectorAll('${CARD} .tug-entry-shell-input-area'),
  ];
  for (const el of hosts) {
    const s = getComputedStyle(el);
    if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) {
      out.push((el.getAttribute("data-testid") || el.className) + " outline=" + s.outline);
    }
    // The ::after overlay the stop uses is legal on the STOP; on the editor
    // itself it is the same illegal ring drawn a different way.
    const after = getComputedStyle(el, "::after");
    if (after.content !== "none" && parseFloat(after.borderTopWidth) > 0) {
      out.push((el.getAttribute("data-testid") || el.className) + " ::after border");
    }
  }
  return out.join(" | ");
})()`;

/**
 * Whether the given editor holds the caret. Read from `document.activeElement`,
 * not from CM6's `.cm-focused` class: an app-test window is not the key window,
 * and WebKit withholds focus-dependent state (`:focus-within`, and the
 * `focus`/`blur` events CM6 sets that class from) even while `activeElement` is
 * correct.
 */
const focused = (sel: string) =>
  `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    return el !== null && document.activeElement !== null &&
      (el === document.activeElement || el.contains(document.activeElement));
  })()`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 680 },
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

async function chord(app: App, code: string, key: string): Promise<void> {
  await app.evalJS<boolean>(
    `(function(){
      var t = document.activeElement || document;
      return t.dispatchEvent(new KeyboardEvent("keydown", {
        code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)},
        metaKey: true, bubbles: true, cancelable: true, composed: true,
      }));
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)("AT0345: a text editor never wears a ring", () => {
  test(
    "no editor host computes an outline, with the caret in the composer or in the find field",
    async () => {
      const app = await launchTugApp({ testName: "at0345-editor-never-rings" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 15_000 },
        );
        await app.bindSession("A", { tugSessionId: SID });
        await app.waitForCondition<boolean>(
          `document.querySelector('${CARD} [data-slot="session-telemetry-status-row"]') !== null`,
          { timeoutMs: 8000 },
        );
        await app.driveSession("A", { op: "send", text: "ask" });
        await app.driveSession("A", {
          op: "ingestFrame",
          feedId: FEED_CODE_OUTPUT,
          decoded: {
            tug_session_id: SID,
            type: "assistant_text",
            msg_id: "m0",
            text: "a settled reply.",
            is_partial: false,
            rev: 0,
            seq: 0,
          },
        });
        await app.driveSession("A", {
          op: "ingestFrame",
          feedId: FEED_CODE_OUTPUT,
          decoded: {
            tug_session_id: SID,
            type: "turn_complete",
            msg_id: "m0",
            result: "success",
          },
        });

        // --- 1. Caret in the composer. ---
        await app.nativeClickAtElement(EDITOR);
        await app.waitForCondition<boolean>(focused(EDITOR), { timeoutMs: 8000 });
        expect(
          await app.evalJS<string>(RINGED_EDITORS),
          "a composer holding the caret wears no ring",
        ).toBe("");

        // --- 2. ⌘F: the caret moves to the query field, two editors mounted. ---
        await chord(app, "KeyF", "f");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(FIND_BAR)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(focused(FIND_INPUT), {
          timeoutMs: 8000,
        });
        expect(
          await app.evalJS<string>(RINGED_EDITORS),
          "a query field holding the caret wears no ring, and neither does the composer beside it",
        ).toBe("");

        // --- 3. Back to the composer with the bar still open. ---
        await app.nativeClickAtElement(EDITOR);
        await app.waitForCondition<boolean>(focused(EDITOR), { timeoutMs: 8000 });
        expect(
          await app.evalJS<string>(RINGED_EDITORS),
          "the caret returning to the composer rings neither editor",
        ).toBe("");

        // --- 4. The cycling stop. ⌥⇥ opens the card's cycle (the caret leaves
        //        the composer), then Tab walks round to the composer's text
        //        stop. The stop carries the editor's focus contract, so
        //        arriving GRANTS the caret — the blinking caret is the whole
        //        focus indication, and nothing rings. No click reaches this
        //        state, which is how a ring lived here through three green
        //        assertions above. ---
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`!(${focused(EDITOR)})`, {
          timeoutMs: 8000,
        });
        let reached = false;
        for (let i = 0; i < CYCLE_STOP_LIMIT && !reached; i++) {
          await app.nativeKey("Tab");
          reached = await app.evalJS<boolean>(focused(EDITOR));
        }
        expect(
          reached,
          "the cycle walk reaches the composer's text stop, which grants the caret",
        ).toBe(true);
        expect(
          await app.evalJS<string>(RINGED_EDITORS),
          "the granted caret is the focus indication — never a ring",
        ).toBe("");
        // …and the shell knows the keyboard is here (this is what lights the
        // entry's default button), so the state is not simply unmarked.
        expect(
          await app.evalJS<boolean>(
            `document.querySelector('${CARD} [data-slot="tug-prompt-entry"]')?.hasAttribute("data-entry-keyboard") === true`,
          ),
          "the shell registers the keyboard's presence",
        ).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
