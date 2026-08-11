/**
 * at9995-textcard-ring-probe.test.ts — SCRATCH diagnostic, not a kept suite.
 *
 * What does ⌥⇥ then Tab actually do on a Text card, with and without the find
 * bar open? Records the ring and DOM focus at every step. No assertions — the
 * diagnostics ARE the result.
 *
 * @covers tugdeck/src/components/tugways/tug-text-card-editor.css
 * @covers tugdeck/src/components/tugways/cards/text-card-status-bar.tsx
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp, note, type App } from "./_harness";

const FILE_BODY = "alpha meridian\nbeta\ngamma\nalpha again\n";
let dir = "";
let filePath = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "at9995-"));
  filePath = join(dir, "fixture.txt");
  writeFileSync(filePath, FILE_BODY);
});

afterAll(() => {
  if (dir !== "" && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const EDITOR_HOST = `${CARD} [data-slot="tug-text-card-editor"]`;
const EDITOR_CONTENT = `${EDITOR_HOST} .cm-content`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
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

/** Ring, DOM focus, and whether either sits in the find bar. */
const STATE = `(() => {
  const a = document.activeElement;
  const ring = document.querySelector("[data-key-view-kbd]");
  const bar = document.querySelector('${CARD} [data-slot="text-card-find-bar"]');
  const host = document.querySelector('${EDITOR_HOST}');
  const name = (el) => el === null ? "—" :
    (el.getAttribute && (el.getAttribute("data-testid") || el.getAttribute("data-slot")) ||
     (el.className || "").toString() || el.tagName).toString().slice(0, 34);
  return JSON.stringify({
    kbf: document.documentElement.hasAttribute("data-kbf"),
    ring: ring === null ? "(none)" : name(ring) + " «" + (ring.textContent || "").trim().slice(0, 18) + "»",
    ringInBar: bar !== null && ring !== null && bar.contains(ring),
    focus: name(a),
    focusInBar: bar !== null && a !== null && bar.contains(a),
    focusInEditor: host !== null && a !== null && host.contains(a),
    barOpen: bar !== null,
  });
})()`;

async function walk(app: App, label: string, steps: number): Promise<void> {
  for (let i = 1; i <= steps; i += 1) {
    await app.nativeKey("Tab");
    note(`${label} Tab ${i}: ` + (await app.evalJS<string>(STATE)));
  }
}

describe.skipIf(!SHOULD_RUN)("AT9995: text card KBF walk", () => {
  test(
    "⌥⇥ and Tab, bar closed then bar open",
    async () => {
      const app = await launchTugApp({ testName: "at9995-textcard-kbf-walk" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({
          state: deckShape(),
          cardStates: {
            A: { content: { path: filePath, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `(() => { const el = document.querySelector('${EDITOR_CONTENT}');
            return el !== null && el.innerText.indexOf("alpha meridian") !== -1; })()`,
          { timeoutMs: 15_000 },
        );
        await app.nativeClickAtElement(EDITOR_CONTENT);
        await app.waitForCondition<boolean>(
          `(() => { const el = document.querySelector('${EDITOR_CONTENT}');
            return el !== null && document.activeElement !== null &&
              (el === document.activeElement || el.contains(document.activeElement)); })()`,
          { timeoutMs: 8000 },
        );

        // ---- Bar CLOSED ----
        note("A. caret in editor: " + (await app.evalJS<string>(STATE)));
        await app.nativeKey("Tab", ["alt"]);
        note("A. after ⌥⇥: " + (await app.evalJS<string>(STATE)));
        await walk(app, "A.", 5);
        // Back out of the mode so the next phase starts clean.
        await app.nativeKey("Tab", ["alt"]);
        note("A. after ⌥⇥ again: " + (await app.evalJS<string>(STATE)));

        // ---- Bar OPEN ----
        await app.nativeKey("f", ["cmd"]);
        await app.waitForCondition<boolean>(
          `document.querySelector('${CARD} [data-slot="text-card-find-bar"]') !== null`,
          { timeoutMs: 8000 },
        );
        note("B. after ⌘F: " + (await app.evalJS<string>(STATE)));
        await app.nativeKey("Tab", ["alt"]);
        note("B. after ⌥⇥: " + (await app.evalJS<string>(STATE)));
        await walk(app, "B.", 8);

        expect(true).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
