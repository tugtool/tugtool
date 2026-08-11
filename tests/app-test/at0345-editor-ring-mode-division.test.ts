/**
 * at0345-editor-ring-mode-division.test.ts — an editor rings iff it is a
 * **parked** stop; a caret-holding editor never does.
 *
 * ## Why this exists, and why it inverted
 *
 * This file used to assert the flat rule "a text editor never wears a focus
 * ring", on the reasoning that the blinking caret is a complete carrier of
 * keyboard focus and a ring beside it is an illegal redundancy. That rule was
 * right about the state it could see and wrong as an axiom, and KBF mode
 * ([roadmap/kbf-mode.md]) traces it as the root of the whole compensation
 * network the mode deletes: with no parked state available, "an editor always
 * has the caret" forced every arrow that reached an editor to either grant it
 * or be pushed back out, which is what the boundary latch, the empty-input
 * release, and the Tab-when-empty handoff all existed to arrange.
 *
 * The mode restores the parked stop, so the rule is now a division rather than
 * an absolute:
 *
 *   - **Mode OFF** — an editor holding the caret wears no ring, exactly as
 *     before. Cases 1–3 below are the original assertions, unchanged, and they
 *     are the half of the old rule that was always true.
 *   - **Mode ON, arrived at by MOVEMENT** — the stop is PARKED: it rings, and
 *     the editor does *not* hold the caret. Case 4 is the old case 4 inverted;
 *     it asserted precisely the state the mode reintroduces.
 *   - **Typing grants.** A printable character at a parked stop clears the mode,
 *     grants the caret, and lands the character — case 5, the transition that
 *     makes the parked state usable rather than a dead end.
 *
 * The seed rule's half (a text-first sheet opens ringed AND with a caret) lives
 * in the parked-stop suite, which can open a sheet; this file stays on the
 * session card.
 *
 * @covers tugdeck/src/components/tugways/tug-text-editor.css
 * @covers tugdeck/src/components/tugways/tug-entry-shell.css
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/styles/focus-ring.css
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, note, type App } from "./_harness";

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

describe.skipIf(!SHOULD_RUN)("AT0345: an editor rings iff it is parked", () => {
  test(
    "mode OFF a caret-holding editor never rings; mode ON a moved-to stop rings with no caret, and typing grants",
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

        // --- 4. The PARKED stop. ⌥⇥ engages the mode and opens the card's
        //        cycle (the caret leaves the composer), then Tab walks round to
        //        the composer's text stop. Arriving by MOVEMENT parks it: the
        //        ring lands on the input area and the editor does NOT take the
        //        caret. This is the case that inverted — it used to assert the
        //        walk granted the caret and nothing rang. ---
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`!(${focused(EDITOR)})`, {
          timeoutMs: 8000,
        });
        await app.waitForCondition<boolean>(
          `document.documentElement.hasAttribute("data-kbf")`,
          { timeoutMs: 8000 },
        );
        // The stop we want is the EDITOR's own — the one registered under the
        // editor's responder id — not merely the first ringed thing inside the
        // prompt entry (the entry holds several stops). Detect it as the ringed
        // key view that CONTAINS the editor; the old test could use "the editor
        // has the caret" for this, which is exactly what parking removes.
        // The composer's own text stop: the key-view element IS the editor (the
        // stop registers on it), so the ring attribute rides that same element.
        // Scoped to the prompt entry because the find bar is still open from
        // case 2 and its query field is a text stop on this walk too.
        const COMPOSER_STOP = `${CARD} [data-slot="tug-prompt-entry"] [data-key-view-kbd][data-slot="tug-text-editor"]`;
        let parked = false;
        for (let i = 0; i < CYCLE_STOP_LIMIT && !parked; i++) {
          await app.nativeKey("Tab");
          parked = await app.evalJS<boolean>(
            `document.querySelector('${COMPOSER_STOP}') !== null`,
          );
        }
        expect(
          parked,
          "the walk reaches the composer's text stop and RINGS it",
        ).toBe(true);
        expect(
          await app.evalJS<boolean>(focused(EDITOR)),
          "a stop arrived at by movement is parked — the editor holds no caret",
        ).toBe(false);
        note(
          "parked state",
          await app.evalJS<string>(
            `(() => {
              const kv = document.querySelector('${CARD} [data-key-view]');
              const active = document.activeElement;
              return JSON.stringify({
                kbf: document.documentElement.hasAttribute("data-kbf"),
                keyView: kv ? kv.getAttribute("data-key-view") : null,
                keyViewRinged: kv ? kv.hasAttribute("data-key-view-kbd") : null,
                active: active ? (active.getAttribute("data-slot") || active.tagName) : null,
              });
            })()`,
          ),
        );

        // --- 5. Typing grants. A printable character at a parked stop clears
        //        the mode, hands the editor real focus, and the browser's own
        //        insertion lands the character there — no synthetic dispatch. ---
        await app.nativeKey("x");
        note(
          "after typing x",
          await app.evalJS<string>(
            `(() => {
              const active = document.activeElement;
              return JSON.stringify({
                kbf: document.documentElement.hasAttribute("data-kbf"),
                active: active ? (active.getAttribute("data-slot") || active.tagName) : null,
                editorText: document.querySelector('${EDITOR}')?.textContent ?? null,
              });
            })()`,
          ),
        );
        await app.waitForCondition<boolean>(focused(EDITOR), { timeoutMs: 8000 });
        expect(
          await app.evalJS<boolean>(
            `document.documentElement.hasAttribute("data-kbf")`,
          ),
          "typing at a parked stop leaves the mode",
        ).toBe(false);
        expect(
          await app.evalJS<string>(RINGED_EDITORS),
          "with the caret granted, the editor is back to wearing no ring",
        ).toBe("");
        expect(
          await app.evalJS<string>(
            `document.querySelector('${EDITOR}')?.textContent ?? ""`,
          ),
          "the character that asked for the caret is the one that got typed",
        ).toContain("x");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
