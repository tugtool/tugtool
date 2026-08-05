/**
 * at0354-insert-file-composer.test.ts — Session ▸ Insert File… (⌘I) lands the
 * picked file in the card's composer, and is offered wherever that composer
 * can be reached.
 *
 * The command is a two-sided gesture: the host runs the open panel and puts
 * the chosen path on the `insert-file` wire, and the frontend routes that
 * wire to the FIRST RESPONDER. Two responders answer it — the prompt entry
 * itself, and the session card's card-content responder, which forwards to
 * its composer. The second is the load-bearing one: the composer is a
 * SIBLING of the transcript, so a first responder anywhere else in the card
 * walks past it entirely, and a command the card can plainly perform must
 * not dim because focus sits one seat over. That pair is what this pins:
 *
 *  - with the caret in the composer, the wire lands a `file` atom at the
 *    caret — the basename as the chip's label, the absolute path as its
 *    value, no run of path characters in the text — which is byte-identical
 *    to what accepting an `@` mention mints;
 *  - after the caret LEAVES the composer for the card's focus cycle, the
 *    item is still enabled and the insertion still lands;
 *  - with a card that has no prompt entry frontmost, nothing in the chain
 *    answers, so the item validates disabled.
 *
 * The panel itself is the host's and modal, so it is out of reach here; the
 * menu item's existence and its ⌘I key equivalent are pinned by the
 * menu-structure test, and this drives the wire the panel would have sent.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/tug-prompt-entry.tsx
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 * @covers tugdeck/src/components/tugways/command-registry.ts
 * @covers tugapp/Sources/AppDelegate.swift
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const EDITOR_CONTENT = `${CARD} .tug-prompt-entry .tug-text-editor .cm-content`;
const FILE_CHIP = `${EDITOR_CONTENT} img[data-atom-type="file"]`;
const MENU_ITEM = "session.insertFile";

/** The paths the panel would have returned. */
const FIRST_PATH = "/Users/someone/project/src/main.ts";
const FIRST_BASENAME = "main.ts";
const SECOND_PATH = "/Users/someone/project/README.md";
const SECOND_BASENAME = "README.md";

const CARET_IN_EDITOR = `(function(){
  var el = document.activeElement;
  return el !== null && el.matches(${JSON.stringify(EDITOR_CONTENT)});
})()`;

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "session", title: "Session", closable: true },
      { id: "B", componentId: "gallery-accordion", title: "Accordion", closable: true },
    ],
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
      {
        id: "p2",
        position: { x: 900, y: 40 },
        size: { width: 520, height: 480 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** Dispatch a real keydown on the focused element, as at0343 does. */
function pressKey(app: App, key: string): Promise<null> {
  return app.evalJS<null>(
    `(function(){
      var el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent("keydown", {
        key: ${JSON.stringify(key)},
        bubbles: true,
        cancelable: true,
      }));
      return null;
    })()`,
  );
}

/** Poll the validated menu-item state until it matches `wantEnabled`. */
async function expectMenuEnabled(
  app: App,
  wantEnabled: boolean,
  where: string,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: { found: boolean; enabled?: boolean } = { found: false };
  while (Date.now() < deadline) {
    last = await app.menuItemState(MENU_ITEM);
    if (last.found && last.enabled === wantEnabled) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(last.found, `${MENU_ITEM} must exist`).toBe(true);
  expect(last.enabled, `${MENU_ITEM} enabled=${wantEnabled} ${where}`).toBe(wantEnabled);
}

/** Send the wire the host's open panel would have sent. */
function sendInsertFile(app: App, path: string): Promise<void> {
  return app.evalJS<void>(
    `window.__tug.dispatchControlAction("insert-file", { path: ${JSON.stringify(path)} })`,
  );
}

/** Every file chip now in the composer, in document order. */
async function chips(app: App): Promise<Array<{ value: string; label: string }>> {
  return JSON.parse(
    await app.evalJS<string>(
      `JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(FILE_CHIP)}))
        .map(function(img){
          return {
            value: img.getAttribute('data-atom-value'),
            label: img.getAttribute('data-atom-label'),
          };
        }))`,
    ),
  ) as Array<{ value: string; label: string }>;
}

describe.skipIf(!SHOULD_RUN)("AT0354: Insert File… lands in the card's composer", () => {
  test(
    "the picked path arrives as a file chip from the caret and from elsewhere in the card",
    async () => {
      const app = await launchTugApp({ testName: "at0354-insert-file" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 30_000 },
        );
        await app.bindSession("A");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(EDITOR_CONTENT)}) !== null`,
          { timeoutMs: 15_000 },
        );

        // --- the caret in the composer -------------------------------
        await app.nativeClickAtElement(EDITOR_CONTENT);
        await app.waitForCondition<boolean>(CARET_IN_EDITOR, { timeoutMs: 8000 });
        await expectMenuEnabled(app, true, "with the caret in the composer");

        // --- the caret elsewhere in the same card --------------------
        // An empty composer has no document to protect, so one Up hands the
        // card's focus cycle the seat — the state the composer-only gate
        // used to dim on.
        await pressKey(app, "ArrowUp");
        await app.waitForCondition<boolean>(`!(${CARET_IN_EDITOR})`, {
          timeoutMs: 5000,
        });
        await expectMenuEnabled(app, true, "with focus elsewhere in the card");

        await sendInsertFile(app, FIRST_PATH);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(FILE_CHIP)}).length === 1`,
          { timeoutMs: 8000 },
        );
        // The value is the whole path — that is what the prompt says — and
        // the label is the basename, which is all a composer line has room
        // for.
        expect(await chips(app)).toEqual([
          { value: FIRST_PATH, label: FIRST_BASENAME },
        ]);

        // The atom is an object, never a run of path characters.
        const literal = await app.evalJS<boolean>(
          `(function(){
            var cm = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
            return cm !== null && (cm.textContent || '').indexOf('/Users/someone') !== -1;
          })()`,
        );
        expect(literal).toBe(false);
        // The insertion took the caret back, so the next thing typed lands
        // beside the file just named.
        expect(await app.evalJS<boolean>(CARET_IN_EDITOR)).toBe(true);

        // --- a second file, this time from the caret -----------------
        await sendInsertFile(app, SECOND_PATH);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(FILE_CHIP)}).length === 2`,
          { timeoutMs: 8000 },
        );
        const both = await chips(app);
        expect(both.map((c) => c.label)).toEqual([FIRST_BASENAME, SECOND_BASENAME]);
        expect(both.map((c) => c.value)).toEqual([FIRST_PATH, SECOND_PATH]);

        // --- no prompt entry in the chain ----------------------------
        await app.seedDeckState({ state: deckShape(), focusCardId: "B" });
        await expectMenuEnabled(app, false, "with a card that has no composer");

        process.stdout.write("VERDICT: PASS\n");
      } catch (err) {
        process.stdout.write("VERDICT: FAIL\n");
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0354] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
