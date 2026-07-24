/**
 * at0215-bang-chrome.test.ts — the composer's chrome now that the sticky
 * routes are gone and every non-Code destination is a per-submission bang
 * routing (`lib/bang-commands.ts`).
 *
 * Drives the REAL session card (the picker + chips live there, not in the
 * gallery prompt-entry wrapper) and asserts:
 *
 *   1. **The static Code chip set** — identity · session · project · mode ·
 *      model · effort, always, with no route to vary it. The find cluster is
 *      the one member that comes and goes, and it is absent at rest.
 *   2. **The Z4A `!` picker** — the menu offers exactly the four routings,
 *      each labeled in its typed `!name` form with its ⌃⌘ chord, and picking
 *      one seeds that routing's chip in the draft. The ⌃⌘ chord seeds the
 *      same chip from the keyboard.
 *   3. **Flanking-cell geometry** — the leading `!` picker (left edge AND
 *      width) and the trailing submit button's right edge do NOT move when
 *      the centred-floating Z4B cluster changes width. `!find` mounting the
 *      find cluster is the live width change.
 *   4. **`!btw` round-trip** — `!btw <question>` opens the side-question
 *      placard and the exchange never touches the transcript (the [D108]
 *      invariant, beside at0211): the settled answer is injected as the
 *      `side_question_answer` frame the probe pinned.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/lib/bang-commands.ts
 * @covers tugdeck/src/components/tugways/tug-prompt-entry.tsx
 * @covers tugdeck/src/lib/commit-mode-controller.ts
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
const ENTRY_ROOT = `${CARD} [data-slot="tug-prompt-entry"]`;
const TOOLBAR = `${CARD} .tug-prompt-entry-toolbar`;
/** The Z4A leading cell — the `!` routing picker's popup trigger. */
const PICKER = `${TOOLBAR} .tug-prompt-entry-command-picker`;
const SUBMIT = `${CARD} .tug-prompt-entry-submit-button`;
const TRANSCRIPT_ENTRIES = `${CARD} [data-slot="tug-transcript-entry"]`;
const FIND_CLUSTER = `${CARD} [data-slot="find-cluster"]`;
const SIDE_Q_ASK = ".side-question-question";
const SIDE_Q_ANSWER = ".side-question-answer";

/** A seeded routing chip in the draft — one atom per routing name. */
const chipSelector = (name: string): string =>
  `${PROMPT} img[data-atom-type="command"][data-atom-value="${name}"]`;

// The bang registry, mirroring `BANG_COMMANDS` in `lib/bang-commands.ts` —
// the picker lists these in this order, each with its ⌃⌘ chord.
const BANGS: ReadonlyArray<{ name: string; shortcut: string }> = [
  { name: "shell", shortcut: "⌃⌘S" },
  { name: "btw", shortcut: "⌃⌘B" },
  { name: "find", shortcut: "⌃⌘G" },
  { name: "history", shortcut: "⌃⌘H" },
];

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

/** Rects of the flanking cells: the leading Z4A picker and the trailing Z5
 *  submit button. The Z4B cluster floats centred between two spacers, so
 *  neither flank may move when it resizes. */
async function flankingRects(
  app: App,
): Promise<{ pickerLeft: number; pickerWidth: number; submitRight: number } | null> {
  return app.evalJS<{
    pickerLeft: number;
    pickerWidth: number;
    submitRight: number;
  } | null>(
    `(function(){
      var p = document.querySelector(${JSON.stringify(PICKER)});
      var s = document.querySelector(${JSON.stringify(SUBMIT)});
      if (!p || !s) return null;
      var pr = p.getBoundingClientRect();
      var sr = s.getBoundingClientRect();
      return { pickerLeft: pr.left, pickerWidth: pr.width, submitRight: sr.right };
    })()`,
  );
}

/** Empty the draft, whatever it holds (typed text or seeded chips). The
 *  emptiness gate is the entry root's `data-empty` bridge — an empty editor
 *  still renders placeholder text, so `.cm-content` text is no signal. */
async function clearDraft(app: App): Promise<void> {
  await app.nativeClickAtElement(PROMPT);
  await app.nativeKey("a", ["cmd"]);
  await app.nativeKey("Backspace");
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(ENTRY_ROOT)}).getAttribute("data-empty") === "true"`,
    { timeoutMs: 4000 },
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
  "AT0215: bang-routing chrome — chip set, picker, geometry, btw round-trip",
  () => {
    test(
      "the static chip set, the four-routing picker, unmoved flanks, and a btw ask that never touches the transcript",
      async () => {
        const app = await launchTugApp({ testName: "at0215-bang-chrome" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindSession("A", { tugSessionId: SID, projectDir: dir });
          await app.awaitEngineReady("A");

          // One committed turn so the transcript has entries to count — and
          // text for `!find` to match.
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

          // --- The static Code chip set, with no find cluster at rest. ---
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
            "the find cluster is absent until a find is active",
          ).toBe(true);

          // --- The Z4A picker offers exactly the four routings. ---
          await app.click(PICKER);
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(".tug-menu-item[data-item-id]").length > 0`,
            { timeoutMs: 4000 },
          );
          const menu = await app.evalJS<
            Array<{ id: string; label: string; shortcut: string }>
          >(
            `Array.from(document.querySelectorAll(".tug-menu-item[data-item-id]")).map(function(el){
               var label = el.querySelector(".tug-menu-item-label");
               var shortcut = el.querySelector(".tug-menu-item-shortcut");
               return {
                 id: el.getAttribute("data-item-id") || "",
                 label: label ? label.textContent.trim() : "",
                 shortcut: shortcut ? shortcut.textContent.trim() : "",
               };
             })`,
          );
          expect(menu, "the picker lists exactly the bang registry").toEqual(
            BANGS.map((b) => ({
              id: b.name,
              label: `!${b.name}`,
              shortcut: b.shortcut,
            })),
          );

          // Picking a routing seeds its chip in the draft.
          await app.click(`.tug-menu-item[data-item-id="btw"]`);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(chipSelector("btw"))}) !== null`,
            { timeoutMs: 4000 },
          );

          // The ⌃⌘ chord is the keyboard twin — it seeds the same chip.
          await clearDraft(app);
          await app.evalJS<boolean>(
            `(function(){
              var target = document.activeElement || document;
              return target.dispatchEvent(new KeyboardEvent("keydown", {
                code: "KeyS", key: "s", ctrlKey: true, metaKey: true,
                bubbles: true, cancelable: true, composed: true,
              }));
            })()`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(chipSelector("shell"))}) !== null`,
            { timeoutMs: 4000 },
          );
          await clearDraft(app);

          // --- Flanking geometry across a real Z4B width change. ---
          const restRects = await flankingRects(app);
          expect(restRects).not.toBeNull();

          // `!find` mounts the find cluster into the centred Z4B cluster.
          await submitLine(app, "!find there");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(FIND_CLUSTER)}) !== null`,
            { timeoutMs: 6000 },
          );
          const findRects = await flankingRects(app);
          expect(findRects).not.toBeNull();
          expect(
            Math.abs(findRects!.pickerLeft - restRects!.pickerLeft),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(findRects!.pickerWidth - restRects!.pickerWidth),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(findRects!.submitRight - restRects!.submitRight),
          ).toBeLessThanOrEqual(1);

          // --- `!btw` → side-question placard, transcript untouched. ---
          const countEntries = () =>
            app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(TRANSCRIPT_ENTRIES)}).length`,
            );
          const baseline = await countEntries();
          expect(baseline).toBeGreaterThan(0);

          await submitLine(app, "!btw what did I just say");
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
