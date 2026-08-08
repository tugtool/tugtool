/**
 * at0364-commit-receipt-path-gestures.test.ts — a filename in a `/commit`
 * receipt is text you can select, and it opens ONE menu.
 *
 * The receipt's file rows are the shared changes rows, authored for the
 * Changes shade where the whole surface refuses focus. Dropped into the
 * transcript they broke two ordinary gestures on what reads as ink:
 *
 *  1. **Sweeping the path selected nothing and opened the file.** The path
 *     carried `data-tug-focus="refuse"`, which makes the gesture interpreter
 *     `preventDefault` the paired mousedown — the same default that begins a
 *     text selection — and the release still arrived as a `click`, so every
 *     attempt to copy a filename opened it in an editor instead.
 *  2. **Right-clicking it opened two menus** — the row's own Radix menu AND
 *     the transcript cell's editing menu, stacked over one press — and the
 *     row's carried two items where a file reference in prose carries four.
 *     A row under a transcript is ink like any other, so it hands its path to
 *     the host: it stamps a `file-path` annotation and renders no menu of its
 *     own, and the host's provider builds the registry's Open in Editor /
 *     Show in Finder / Copy Path / Insert into Composer over the standard
 *     editing block.
 *
 * Both are pinned here on a real receipt with real native gestures: a drag
 * across the path leaves a selection and opens no card; a right-click leaves
 * exactly one menu, carrying the whole file-reference vocabulary; and a plain
 * click still opens the file, so the drag guard didn't cost the row its
 * gesture.
 *
 * @covers tugdeck/src/components/tugways/tug-changes-list.tsx
 * @covers tugdeck/src/components/tugways/tug-context-menu.tsx
 * @covers tugdeck/src/lib/annotator/annotation-element.ts
 * @covers tugdeck/src/components/tugways/cards/session-commit-receipt-block.tsx
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "test-session-A";
const FILE_PATH = "lib/verdict-batching.ts";

const CARD = '[data-card-id="A"]';
const RECEIPT = `${CARD} [data-slot="commit-receipt-block"]`;
const FILE_REF = `${RECEIPT} [data-slot="tug-changes-list-file-ref"]`;
const OWN_MENU = '[data-slot="tug-context-menu"]';
const CELL_MENU = '[data-slot="tug-editor-context-menu"]';

/** How many distinct cards the deck is showing. */
const CARD_COUNT = `new Set(
  Array.from(document.querySelectorAll("[data-card-id]")).map(
    (el) => el.getAttribute("data-card-id"),
  ),
).size`;

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0364-commit-"));
  mkdirSync(join(projectDir, "lib"), { recursive: true });
  writeFileSync(join(projectDir, FILE_PATH), "export const a = 1;\n", "utf8");
});
afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 640 },
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

/**
 * The S02 commit-summary shape the receipt parses — the machine header, the
 * `files:` roster that becomes the rows, then the message. (`·` is U+00B7,
 * `−` U+2212 — matched exactly.)
 */
function commitOutput(): string {
  return [
    "committed 95428607 · 1 file(s) · +16 −1",
    `files: [{"path":"${FILE_PATH}","status":"modified","added":16,"removed":1}]`,
    "tugdash(annotator-perf): fix content-annotation invalidation",
  ].join("\n");
}

describe.skipIf(!SHOULD_RUN)(
  "AT0364: a receipt's filename selects, opens one menu, and still opens on a click",
  () => {
    test(
      "drag selects instead of opening; right-click opens exactly one menu; a click opens the file",
      async () => {
        const app = await launchTugApp({
          testName: "at0364-commit-receipt-path-gestures",
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );
          await app.bindSession("A", {
            tugSessionId: SID,
            sessionMode: "resume",
            projectDir,
            workspaceKey: projectDir,
          });
          await app.ingestSessionMetadata("A", {
            type: "system_metadata",
            tug_session_id: SID,
            session_id: SID,
            cwd: projectDir,
          });

          await app.driveSession("A", {
            op: "shellExchange",
            exchangeId: "commit-1",
            command: "/commit",
            output: commitOutput(),
            cwd: projectDir,
            exitCode: 0,
            startedAtMs: 1_700_000_000_000,
          });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(FILE_REF)}) !== null`,
            { timeoutMs: 20_000 },
          );

          const cardsBefore = await app.evalJS<number>(CARD_COUNT);

          // ---- 1. A sweep across the path is a selection, not a click ----
          const bounds = await app.getElementBounds(FILE_REF);
          const midY = bounds.y + bounds.height / 2;
          await app.nativeDrag(
            { x: bounds.x + 2, y: midY },
            { x: bounds.x + bounds.width - 2, y: midY },
            { mouseDownDelayMs: 120 },
          );

          const selection = await app.getSelection("A");
          expect(selection?.kind).toBe("range");
          const selectedText =
            selection !== null && selection.kind === "range" ? selection.text : "";
          expect(selectedText.length).toBeGreaterThan(0);
          expect(FILE_PATH).toContain(selectedText.trim());
          // Nothing opened: the gesture named text, it didn't ask for a card.
          expect(await app.evalJS<number>(CARD_COUNT)).toBe(cardsBefore);

          // ---- 2. One press, one menu, the whole file-reference vocabulary ----
          await app.nativeRightClickAtElement(FILE_REF);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CELL_MENU)}) !== null`,
            { timeoutMs: 6000 },
          );
          // Settle, so a second menu that was going to mount has mounted.
          await new Promise((resolve) => setTimeout(resolve, 250));
          const menus = await app.evalJS<{
            own: number;
            cell: number;
            items: string[];
          }>(
            `(() => ({
               own: document.querySelectorAll(${JSON.stringify(OWN_MENU)}).length,
               cell: document.querySelectorAll(${JSON.stringify(CELL_MENU)}).length,
               items: Array.from(
                 document.querySelectorAll(
                   ${JSON.stringify(`${CELL_MENU} .tug-menu-item`)},
                 ),
               ).map((el) => (el.textContent ?? "").trim()),
             }))()`,
          );
          // The host's provider serves it, and the row adds no second menu.
          expect(menus.cell).toBe(1);
          expect(menus.own).toBe(0);
          // The registry's file-path entries lead, in registry order…
          expect(menus.items.slice(0, 4)).toEqual([
            "Open in Editor",
            "Show in Finder",
            "Copy Path",
            "Insert into Composer",
          ]);
          // …over the standard editing block, which a file reference in prose
          // keeps too (`suppressStandardItems: false`).
          expect(menus.items.some((label) => label.startsWith("Select All"))).toBe(true);

          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CELL_MENU)}) === null`,
            { timeoutMs: 6000 },
          );

          // ---- 3. A click with no travel still opens the file ----
          await app.nativeClickAtElement(FILE_REF);
          await app.waitForCondition<boolean>(`${CARD_COUNT} > ${cardsBefore}`, {
            timeoutMs: 20_000,
          });

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0364] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
