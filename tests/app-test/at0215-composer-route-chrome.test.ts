/**
 * at0215-composer-route-chrome.test.ts — the composer's chrome now that the
 * `!` layer is gone and Z4A holds the two routes.
 *
 * Drives the REAL session card (the route group and the chips live there, not
 * in the gallery prompt-entry wrapper) and asserts:
 *
 *   1. **The static Code chip set** — identity · session · project · mode ·
 *      model · effort, always, with no route to vary it. The find cluster is
 *      not among them: it lives in the find bar, which owns the search.
 *   2. **The Z4A route group** — exactly two segments, labelled Prompt and
 *      Changes, with Prompt selected at rest. Clicking Changes selects it and
 *      raises the Changes shade; clicking Prompt comes back.
 *   3. **Flanking-cell geometry** — the leading Z4A group (left edge AND
 *      width) does NOT move when the centred-floating Z4B cluster changes
 *      width. The Prompt↔Changes switch is the live width change: commit
 *      mode swaps Z4B's Code chips for the commit cluster.
 *   4. **`/btw` round-trip** — `/btw <question>` opens the side-question
 *      placard and the exchange never touches the transcript (the [D108]
 *      invariant, beside at0211): the settled answer is injected as the
 *      `side_question_answer` frame the probe pinned.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/tug-prompt-entry.tsx
 * @covers tugdeck/src/lib/commit-mode-controller.ts
 * @covers tugdeck/src/components/tugways/cards/effort-chip.tsx
 * @covers tugdeck/src/components/tugways/cards/side-question-overlay.tsx
 * @covers tugdeck/src/components/tugways/tug-find-cluster.tsx
 * @covers tugdeck/src/components/tugways/tug-transcript-entry.tsx
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0215";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const PROMPT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const TOOLBAR = `${CARD} .tug-prompt-entry-toolbar`;
/** The Z4A leading cell — the two-route choice group. */
const ROUTE_GROUP = `${TOOLBAR} .tug-prompt-entry-route-group`;
const ROUTE_SEGMENTS = `${ROUTE_GROUP} .tug-choice-group-segment`;
const ROUTE_SEGMENT = (value: string): string =>
  `${ROUTE_GROUP} [data-choice-value="${value}"]`;
const TRANSCRIPT_ENTRIES = `${CARD} [data-slot="tug-transcript-entry"]`;
const FIND_CLUSTER = `${CARD} [data-slot="find-cluster"]`;
const SIDE_Q_ASK = ".side-question-question";
const SIDE_Q_ANSWER = ".side-question-answer";

// The static Code chip set — no route varies it any more.
const STATIC_CHIPS = [
  "session-route-indicator-badge",
  "session-id-badge",
  "project-chip",
  "permission-mode-chip",
  "model-chip",
  "effort-chip",
] as const;

let dir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  dir = mkdtempSync(join(tmpdir(), "at0215-"));
});

afterAll(() => {
  if (dir !== "" && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session A", closable: true }],
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

/** Which of the static chips are currently mounted. */
async function mountedChips(app: App): Promise<string[]> {
  return app.evalJS<string[]>(
    `(function(){
      var slots = ${JSON.stringify([...STATIC_CHIPS])};
      return slots.filter(function(s){
        return document.querySelector(${JSON.stringify(CARD)} + ' [data-slot="' + s + '"]') !== null;
      });
    })()`,
  );
}

/** The route group's segments: label plus whether it reads as selected. */
async function routeSegments(
  app: App,
): Promise<Array<{ label: string; active: boolean }>> {
  return app.evalJS<Array<{ label: string; active: boolean }>>(
    `Array.from(document.querySelectorAll(${JSON.stringify(ROUTE_SEGMENTS)})).map(function(el){
       return {
         label: (el.textContent || "").trim(),
         active: el.getAttribute("data-state") === "active",
       };
     })`,
  );
}

/** The leading Z4A cell's rect. The Z4B cluster floats centred between two
 *  spacers, so the leading flank must not move when it resizes. */
async function routeGroupRect(
  app: App,
): Promise<{ left: number; width: number } | null> {
  return app.evalJS<{ left: number; width: number } | null>(
    `(function(){
      var g = document.querySelector(${JSON.stringify(ROUTE_GROUP)});
      if (!g) return null;
      var r = g.getBoundingClientRect();
      return { left: r.left, width: r.width };
    })()`,
  );
}

/** Focus the editor, type `line`, settle, and force-submit with ⌘Return. */
async function submitLine(app: App, line: string): Promise<void> {
  await app.nativeClickAtElement(PROMPT);
  await app.nativeType(line);
  await new Promise((r) => setTimeout(r, 150));
  await app.nativeKey("Enter", ["cmd"]);
}

describe.skipIf(!SHOULD_RUN)(
  "AT0215: composer route chrome — chip set, route tabs, geometry, btw round-trip",
  () => {
    test(
      "the static chip set, a two-segment route group, an unmoved leading flank, and a btw ask that never touches the transcript",
      async () => {
        const app = await launchTugApp({ testName: "at0215-composer-route-chrome" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindSession("A", { tugSessionId: SID, projectDir: dir });
          await app.awaitEngineReady("A");

          // One committed turn so the transcript has entries to count.
          await app.driveSession("A", { op: "send", text: "hello" });
          const frame = (decoded: Record<string, unknown>) =>
            app.driveSession("A", {
              op: "ingestFrame",
              feedId: FEED_CODE_OUTPUT,
              decoded: { tug_session_id: SID, ...decoded },
            });
          await frame({ type: "prompt_anchor", promptUuid: "uuid-1" });
          await frame({
            type: "content_block_start",
            msg_id: "m1",
            block_index: 0,
            kind: "text",
          });
          await frame({
            type: "assistant_text",
            msg_id: "m1",
            block_index: 0,
            text: "hi there",
            is_partial: false,
          });
          await frame({ type: "turn_complete", msg_id: "m1", result: "success" });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(PROMPT)}) !== null`,
            { timeoutMs: 8000 },
          );

          // --- The static Code chip set, with no find cluster in Z4B. ---
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CARD)} + ' [data-slot="effort-chip"]') !== null`,
            { timeoutMs: 8000 },
          );
          expect((await mountedChips(app)).sort(), "static Code chip set").toEqual(
            [...STATIC_CHIPS].sort(),
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(FIND_CLUSTER)}) === null`,
            ),
            "the find cluster is not in Z4B — it belongs to the find bar",
          ).toBe(true);

          // --- Z4A is exactly two routes, Prompt selected at rest. ---
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROUTE_SEGMENTS)}).length === 2`,
            { timeoutMs: 8000 },
          );
          expect(await routeSegments(app), "the composer's two routes").toEqual([
            { label: "Prompt", active: true },
            { label: "Changes", active: false },
          ]);

          // --- Flanking geometry across a real Z4B width change. ---
          // Entering Changes swaps Z4B's Code chips for the commit cluster —
          // the centred slot's width event. The leading flank must not move.
          const restRect = await routeGroupRect(app);
          expect(restRect).not.toBeNull();

          await app.click(ROUTE_SEGMENT("changes"));
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CARD)} + ' .session-view-slot[data-active-view="changes"]') !== null`,
            { timeoutMs: 6000 },
          );
          expect(
            await routeSegments(app),
            "clicking Changes selects it",
          ).toEqual([
            { label: "Prompt", active: false },
            { label: "Changes", active: true },
          ]);

          const changesRect = await routeGroupRect(app);
          expect(changesRect).not.toBeNull();
          expect(
            Math.abs(changesRect!.left - restRect!.left),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(changesRect!.width - restRect!.width),
          ).toBeLessThanOrEqual(1);

          // Back to Prompt — the group is how you leave Changes.
          await app.click(ROUTE_SEGMENT("prompt"));
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CARD)} + ' .session-view-slot[data-active-view="changes"]') === null`,
            { timeoutMs: 6000 },
          );
          expect(await routeSegments(app), "clicking Prompt comes back").toEqual([
            { label: "Prompt", active: true },
            { label: "Changes", active: false },
          ]);

          // --- `/btw` → side-question placard, transcript untouched. ---
          const countEntries = () =>
            app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(TRANSCRIPT_ENTRIES)}).length`,
            );
          const baseline = await countEntries();
          expect(baseline).toBeGreaterThan(0);

          await submitLine(app, "/btw what did I just say");
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-slot="side-question-body"]') !== null &&
             document.querySelector(${JSON.stringify(SIDE_Q_ASK)}) !== null`,
            { timeoutMs: 6000 },
          );
          expect(await countEntries(), "the ask must not add a transcript entry").toBe(
            baseline,
          );

          // Settle the answer (the probe-pinned frame shape) through the real
          // SideQuestionStore — it minted `btw-1` for the first ask.
          await app.ingestSideQuestionAnswer("A", {
            type: "side_question_answer",
            request_id: "btw-1",
            answer: "You said: hello",
            synthetic: false,
          });
          await app.waitForCondition<boolean>(
            `Array.from(document.querySelectorAll(${JSON.stringify(SIDE_Q_ANSWER)})).some((el) => el.textContent && el.textContent.indexOf("You said: hello") !== -1)`,
            { timeoutMs: 6000 },
          );
          expect(
            await countEntries(),
            "the settled answer must not add a transcript entry ([D108])",
          ).toBe(baseline);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
