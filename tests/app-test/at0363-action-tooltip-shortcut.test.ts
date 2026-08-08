/**
 * at0363-action-tooltip-shortcut.test.ts — a control that duplicates a
 * keyboard shortcut says so in its tooltip, and the chord it shows is the
 * one the keymap registry holds rather than a string somebody typed.
 *
 * The Text card's Save button is the specimen: it dispatches
 * `TUG_ACTIONS.SAVE`, which carries a default binding and a mirrored menu
 * item (`file.save`). So the chip can be checked against a source the
 * tooltip does not read — the macOS menu bar's own key equivalent for
 * File ▸ Save, captured through the Swift menu snapshot. If the tooltip
 * ever drifts from the registry, the two disagree.
 *
 * The button is disabled while the buffer is clean, and a disabled button
 * swallows the pointer, so the test dirties a real file first — which is
 * also the state a reader is actually in when they reach for Save.
 *
 * Drives the real path: a real file in a real manual-mode Text card, a real
 * `pointerenter` at the real button, and Radix's real open machinery
 * portalling a real bubble into the canvas overlay. Nothing is stubbed.
 *
 * A second test runs the same check on the Z4B **AI Model** chip, whose chord
 * reaches the command through a different door: `run-slash-command:model` is a
 * slash bridge, and its chord is menu-eligible, so AppKit's key-equivalent
 * scan owns it and the Session ▸ AI Model… item is where it has to land. Two
 * doors, one table — and this is what says so.
 *
 * @covers tugdeck/src/components/tugways/tug-action-tooltip.tsx
 * @covers tugdeck/src/components/tugways/tug-tooltip.tsx
 * @covers tugdeck/src/components/tugways/cards/text-card-top-bar.tsx
 * @covers tugdeck/src/components/tugways/cards/ai-chip.tsx
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const EDITOR_CONTENT = `${CARD} [data-slot="tug-text-card-editor"] .cm-content`;
// `TugIconButton` names a fixed prop list and drops anything else, so the
// button carries no test id of its own; its aria-label is the stable handle.
const SAVE_BUTTON = `${CARD} [data-slot="text-card-top-bar"] button[aria-label="Save"]`;
const MODEL_CHIP = `${CARD} [data-slot="ai-chip"]`;
const BUBBLE = ".tug-tooltip-content";
const CHIP = ".tug-tooltip-content .tug-tooltip-shortcut";

const ORIGINAL = "alpha\nbeta\ngamma\n";

/** NSEvent.ModifierFlags bits the menu snapshot reports. */
const NS_SHIFT = 1 << 17;
const NS_CONTROL = 1 << 18;
const NS_OPTION = 1 << 19;
const NS_COMMAND = 1 << 20;

/** Render a menu item's key equivalent the way a chord chip spells it. */
function menuChord(keyEquivalent: string, modifierMask: number): string {
  const parts: string[] = [];
  if ((modifierMask & NS_CONTROL) !== 0) parts.push("⌃");
  if ((modifierMask & NS_OPTION) !== 0) parts.push("⌥");
  if ((modifierMask & NS_SHIFT) !== 0) parts.push("⇧");
  if ((modifierMask & NS_COMMAND) !== 0) parts.push("⌘");
  parts.push(keyEquivalent.toUpperCase());
  return parts.join("");
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** A session card, which is where the Z4B chip strip lives. */
function sessionDeckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 600 },
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

async function typeIntoEditor(app: App, text: string): Promise<void> {
  const ok = await app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector('${EDITOR_CONTENT}');
      if (!el) return false;
      el.focus();
      return document.execCommand("insertText", false, ${JSON.stringify(text)});
    })()`,
  );
  if (!ok) throw new Error("[at0363] typeIntoEditor: insertText not handled");
}

describe.skipIf(!SHOULD_RUN)("at0363 — action tooltip names the chord", () => {
  test(
    "hovering Save shows the phrase and the registry's chord",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0363-"));
      const file = path.join(dir, "manual.txt");
      fs.writeFileSync(file, ORIGINAL, "utf8");
      const app = await launchTugApp({ testName: "at0363-action-tooltip" });
      try {
        await app.seedDeckState({
          state: deckShape(),
          cardStates: {
            A: {
              content: { path: file, anchor: { line: 1, ch: 0 }, scrollTop: 0 },
            },
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${EDITOR_CONTENT}');
            return el !== null && el.innerText.indexOf("alpha") !== -1;
          })()`,
          { timeoutMs: 15000 },
        );

        // Nothing is hovered, so nothing is explained.
        expect(
          await app.evalJS<number>(`document.querySelectorAll('${BUBBLE}').length`),
        ).toBe(0);

        // Save only takes the pointer once there is something to save.
        await typeIntoEditor(app, "delta\n");
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${SAVE_BUTTON}');
            return el !== null && el.disabled !== true;
          })()`,
          { timeoutMs: 8000 },
        );

        // A real pointerenter at the real trigger. Radix opens on its own
        // delay, so the bubble is waited for rather than assumed.
        await app.evalJS<null>(
          `(function(){
            var el = document.querySelector('${SAVE_BUTTON}');
            el.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
            el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
            return null;
          })()`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('${CHIP}') !== null`,
          { timeoutMs: 5000 },
        );

        const phrase = await app.getElementText(BUBBLE);
        expect(phrase).toContain("Write this buffer to its file");

        // The chip against a source the tooltip never reads: the menu bar's
        // own key equivalent for the same command.
        const chip = await app.getElementText(CHIP);
        const item = await app.menuItemState("file.save");
        expect(item.found).toBe(true);
        if (!item.found) throw new Error("[at0363] file.save not in the menu");
        expect(chip).toBe(menuChord(item.keyEquivalent, item.modifierMask));
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the AI chip names the chord the Session menu carries",
    async () => {
      const app = await launchTugApp({ testName: "at0363-ai-chip" });
      try {
        await app.seedDeckState({ state: sessionDeckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        // The Z4B strip is the bound session's, so the card needs one (the
        // at0196 idiom).
        await app.bindSession("A");
        await app.waitForCondition<boolean>(
          `document.querySelector('${MODEL_CHIP}') !== null`,
          { timeoutMs: 15000 },
        );

        await app.evalJS<null>(
          `(function(){
            var el = document.querySelector('${MODEL_CHIP}');
            el.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
            el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
            return null;
          })()`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('${CHIP}') !== null`,
          { timeoutMs: 5000 },
        );

        // The bridge's chord is menu-eligible, so the Session item is where
        // AppKit's scan lands it — and the chip has to agree with that item.
        const chip = await app.getElementText(CHIP);
        const item = await app.menuItemState("session.ai");
        expect(item.found).toBe(true);
        if (!item.found) throw new Error("[at0363] session.ai not in the menu");
        expect(
          item.keyEquivalent,
          "the sweep wrote the bridge's chord onto its menu item",
        ).not.toBe("");
        expect(chip).toBe(menuChord(item.keyEquivalent, item.modifierMask));
        note("at0363 model chord", chip);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
