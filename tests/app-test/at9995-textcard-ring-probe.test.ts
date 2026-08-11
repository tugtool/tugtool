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

        // ---- Focus-call tracing across ⌘F ----
        await app.evalJS(`(() => {
          window.__at9995 = [];
          const log = [];
          window.__at9995FocusLog = log;
          const orig = HTMLElement.prototype.focus;
          HTMLElement.prototype.focus = function (...args) {
            const stack = (new Error().stack || "").split("\\n").slice(1, 10).join(" | ");
            log.push({
              t: Math.round(performance.now()),
              el: ((this.getAttribute && (this.getAttribute("data-testid") || this.getAttribute("data-slot"))) ||
                this.className || this.tagName).toString().slice(0, 44),
              stack,
            });
            return orig.apply(this, args);
          };
        })()`);

        // ---- Bar OPEN ----
        await app.nativeKey("f", ["cmd"]);
        await app.waitForCondition<boolean>(
          `document.querySelector('${CARD} [data-slot="text-card-find-bar"]') !== null`,
          { timeoutMs: 8000 },
        );
        note("B. after ⌘F: " + (await app.evalJS<string>(STATE)));
        const focusLog = await app.evalJS<string>(
          `JSON.stringify(window.__at9995FocusLog || [])`,
        );
        for (const entry of JSON.parse(focusLog) as Array<{
          t: number;
          el: string;
          stack: string;
        }>) {
          note(`B. focus@${entry.t} → ${entry.el}`);
          note(`   ${entry.stack}`);
        }
        const placeLog = await app.evalJS<string>(
          `JSON.stringify(window.__at9995 || [])`,
        );
        for (const entry of JSON.parse(placeLog) as Array<{
          t: number;
          target: unknown;
          cardId: unknown;
          opts: unknown;
          stack: string[];
        }>) {
          note(
            `B. place@${entry.t} target=${JSON.stringify(entry.target)} card=${String(entry.cardId)} opts=${JSON.stringify(entry.opts)}`,
          );
          note(`   ${entry.stack.join(" | ")}`);
        }
        // ---- Pointer click on a cluster control while the caret is in the
        // query field: does the caret survive? (at0223's Case-toggle step.)
        await app.nativeType("alpha");
        await app.nativeClickAtElement(
          `${CARD} [data-slot="text-card-find-bar"] button[aria-label="Match case"]`,
        );
        note("C. after Case click: " + (await app.evalJS<string>(STATE)));
        const clickFocusLog = await app.evalJS<string>(
          `JSON.stringify((window.__at9995FocusLog || []).slice(-4))`,
        );
        for (const entry of JSON.parse(clickFocusLog) as Array<{
          t: number;
          el: string;
          stack: string;
        }>) {
          note(`C. focus@${entry.t} → ${entry.el}`);
          note(`   ${entry.stack}`);
        }
        await app.nativeKey("Return");
        note(
          "C. chip after Return: " +
            (await app.evalJS<string>(
              `(document.querySelector('${CARD} [data-slot="find-count"] [data-slot="find-count-value"]') || {textContent: "(none)"}).textContent`,
            )) +
            " " +
            (await app.evalJS<string>(STATE)),
        );

        await app.nativeKey("Tab", ["alt"]);
        note("B. after ⌥⇥: " + (await app.evalJS<string>(STATE)));
        await walk(app, "B.", 8);

        // ---- D: Escape at a parked TEXT stop grants the caret there ----
        // The walk above left the ring on the query field (Tab 8). Escape must
        // land the caret in the QUERY FIELD, not the card's editor.
        await app.nativeKey("Escape");
        note("D. Escape at parked query stop: " + (await app.evalJS<string>(STATE)));

        // Control: ring on a NON-text stop still pops to the resting editor.
        await app.nativeKey("Tab", ["alt"]);
        note("D. after ⌥⇥ (from query caret): " + (await app.evalJS<string>(STATE)));
        // Walk until the ring sits on the line-ending button (non-text stop).
        await walk(app, "D.", 4);
        await app.nativeKey("Escape");
        note("D. Escape at button stop: " + (await app.evalJS<string>(STATE)));

        expect(true).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
