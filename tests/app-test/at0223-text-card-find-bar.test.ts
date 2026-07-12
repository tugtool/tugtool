/**
 * at0223-text-card-find-bar.test.ts — the Text card's bottom-docked find
 * bar ([AT0223]).
 *
 * ## Why this exists
 *
 * The Text card's find moved from an undesigned top strip to a bottom bar
 * that mirrors the Dev card's Find route: query field + the shared
 * Case/Word/Grep cluster + a width-stabilized "N of M" chip + Previous/Next,
 * driven by the editor's own CodeMirror search (virtualization-proof). ⌘F
 * summons it, Escape dismisses, and the option toggles persist through the
 * GLOBAL find-options preference (`dev.tugtool.find`/`options`).
 *
 * ## Test matrix (one card over a real temp file)
 *
 *   1. ⌘F opens the bar BELOW the editor (DOM order: editor → bar → status
 *      bar); typing a query paints CM6 matches and the chip reads "1 of 3";
 *      Next/⌘-free Enter advances the ordinal; toggling Case narrows the
 *      count live; Escape closes the bar and clears the decorations.
 *   2. The Case toggle survives into a fresh bar (global persistence).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

let dir = "";
let filePath = "";

// Three `meridian` occurrences; exactly one is capital-M.
const FILE_BODY = [
  "alpha meridian line one",
  "beta line two",
  "gamma Meridian line three",
  "delta meridian line four",
  "epsilon closing line",
].join("\n");

beforeAll(() => {
  if (!SHOULD_RUN) return;
  dir = mkdtempSync(join(tmpdir(), "at0223-"));
  filePath = join(dir, "fixture.txt");
  writeFileSync(filePath, FILE_BODY);
});

afterAll(() => {
  if (dir !== "" && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 30, y: 30 },
        size: { width: 780, height: 560 },
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

const EDITOR_CONTENT_SELECTOR =
  '[data-card-id="A"] [data-slot="tug-text-card-editor"] .cm-content';
const BAR_SELECTOR = '[data-card-id="A"] [data-slot="text-card-find-bar"]';
const INPUT_SELECTOR = `${BAR_SELECTOR} [data-testid="text-card-find-input"]`;
const CHIP_SELECTOR = `${BAR_SELECTOR} [data-slot="find-count"] [data-slot="find-count-value"]`;

async function mountTextCard(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {
      A: { content: { path: filePath, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
    },
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(EDITOR_CONTENT_SELECTOR)});
      return el !== null && el.innerText.indexOf("alpha meridian") !== -1;
    })()`,
    { timeoutMs: 15_000 },
  );
}

async function openBar(app: App): Promise<void> {
  // ⌘F rides the responder chain — focus the editor, then dispatch the
  // chord synthetically (the keybinding matcher keys on code+modifiers).
  await app.nativeClickAtElement(EDITOR_CONTENT_SELECTOR);
  await app.evalJS<boolean>(
    `(function(){
      var target = document.activeElement || document;
      return target.dispatchEvent(new KeyboardEvent("keydown", {
        code: "KeyF", key: "f", metaKey: true,
        bubbles: true, cancelable: true, composed: true,
      }));
    })()`,
  );
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(BAR_SELECTOR)}) !== null`,
    { timeoutMs: 4000 },
  );
}

async function waitForChip(app: App, expected: string): Promise<void> {
  await app.waitForCondition<boolean>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(CHIP_SELECTOR)});
      return el !== null && (el.textContent || '').trim() === ${JSON.stringify(expected)};
    })()`,
    { timeoutMs: 6000 },
  );
}

describe.skipIf(!SHOULD_RUN)("AT0223: text card bottom find bar", () => {
  test(
    "⌘F opens the bottom bar; query counts, navigates, narrows on Case, closes on Escape",
    async () => {
      const app = await launchTugApp({ testName: "at0223-bar" });
      try {
        await mountTextCard(app);
        await openBar(app);

        // Placement: the bar sits BETWEEN the editor and the status bar.
        const order = await app.evalJS<boolean>(
          `(() => {
            const bar = document.querySelector(${JSON.stringify(BAR_SELECTOR)});
            const editor = document.querySelector('[data-card-id="A"] [data-slot="tug-text-card-editor"]');
            const status = document.querySelector('[data-card-id="A"] .text-card-status-bar');
            if (!bar || !editor || !status) return false;
            return Boolean(
              (editor.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING) &&
              (bar.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING)
            );
          })()`,
        );
        expect(order, "bar must dock between the editor and the status bar").toBe(true);

        // Query: three case-insensitive hits, first active.
        await app.nativeType("meridian");
        await waitForChip(app, "1 of 3");
        const decorated = await app.evalJS<number>(
          `document.querySelectorAll('[data-card-id="A"] .cm-searchMatch').length`,
        );
        expect(decorated).toBeGreaterThanOrEqual(3);

        // Enter lands on the first match (the chip's initial "1 of N" face
        // shows no live selection yet), and a second Enter advances.
        await app.nativeKey("Return");
        await app.nativeKey("Return");
        await waitForChip(app, "2 of 3");

        // Case toggle narrows to the two lowercase hits, live — and the
        // toggles ride the shared cluster.
        await app.click(`${BAR_SELECTOR} button[aria-label="Match case"]`);
        await waitForChip(app, "1 of 2");

        // Escape closes the bar and clears the decorations.
        await app.nativeClickAtElement(INPUT_SELECTOR);
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(BAR_SELECTOR)}) === null`,
          { timeoutMs: 4000 },
        );
        const remaining = await app.evalJS<number>(
          `document.querySelectorAll('[data-card-id="A"] .cm-searchMatch').length`,
        );
        expect(remaining).toBe(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the Case toggle persists into a freshly opened bar (global find options)",
    async () => {
      const app = await launchTugApp({ testName: "at0223-persist" });
      try {
        await mountTextCard(app);
        await openBar(app);
        // Seed: turn Case ON (persists via putFindOptions).
        await app.click(`${BAR_SELECTOR} button[aria-label="Match case"]`);
        await app.waitForCondition<boolean>(
          `(() => {
            const btn = document.querySelector(${JSON.stringify(BAR_SELECTOR)} + ' button[aria-label="Match case"]');
            return btn !== null && btn.getAttribute('aria-pressed') === 'true';
          })()`,
          { timeoutMs: 4000 },
        );
        // Close and reopen: the fresh bar seeds from the persisted options.
        await app.nativeClickAtElement(INPUT_SELECTOR);
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(BAR_SELECTOR)}) === null`,
          { timeoutMs: 4000 },
        );
        await openBar(app);
        const pressed = await app.evalJS<string>(
          `(() => {
            const btn = document.querySelector(${JSON.stringify(BAR_SELECTOR)} + ' button[aria-label="Match case"]');
            return btn ? String(btn.getAttribute('aria-pressed')) : 'absent';
          })()`,
        );
        expect(pressed).toBe("true");
        // And the case-sensitive count reflects it immediately.
        await app.nativeType("meridian");
        await waitForChip(app, "1 of 2");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
