/**
 * at0215-route-chrome.test.ts — the three-route Session card: per-route Z4B
 * chrome manifest, flanking-cell geometry, and the `?` route's side-question
 * round-trip ([P01]/[P02]/[P03], Table T01, Risk R04, roadmap/route-enhancements.md).
 *
 * Drives the REAL session card (the manifest + chips live there, not in the
 * gallery prompt-entry wrapper), cycling routes via a route popup pick and
 * the ⇧⌘ keybinding, and asserts:
 *
 *   1. **Table T01 chip presence/absence** — each route mounts exactly its
 *      chip set (chips a route drops UNMOUNT, they are not merely disabled).
 *   2. **Risk R04 geometry** — the leading Z4A route popup (left edge AND
 *      width — it is width-stabilized to the widest route label) and the
 *      trailing Z5 submit button's right edge do NOT move when the
 *      centred-floating Z4B cluster swaps width across routes.
 *   3. **`?`-route dispatch ([P02])** — submitting on the btw route opens the
 *      side-question overlay and the exchange never touches the transcript
 *      (the [D108] invariant, beside at0211): the settled answer is injected
 *      as the `side_question_answer` frame the probe pinned.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
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
/** The Z4A route popup trigger — a filled button reading the current route's
 *  label. Width-stabilized, so it holds a hidden alternate too; read the
 *  active variant for the live label. */
const ROUTE_TRIGGER = `${TOOLBAR} button[aria-label="Route"]`;
const ROUTE_LABEL = `${ROUTE_TRIGGER} [data-tug-stable="active"]`;
const SUBMIT = `${CARD} .tug-prompt-entry-submit-button`;
const TRANSCRIPT_ENTRIES = `${CARD} [data-slot="tug-transcript-entry"]`;
const SIDE_Q_ASK = ".side-question-question";
const SIDE_Q_ANSWER = ".side-question-answer";

// Route values + labels, mirroring `ROUTE_ITEMS` in `tug-prompt-entry.tsx`.
const ROUTE_CODE = "❯";
const ROUTE_SHELL = "$";
const ROUTE_BTW = "?";
const LABEL_BY_ROUTE: Readonly<Record<string, string>> = {
  [ROUTE_CODE]: "Code",
  [ROUTE_SHELL]: "Shell",
  [ROUTE_BTW]: "btw",
};
// Chip data-slots (in the session card's Z4B cluster).
const CHIP = {
  identity: "session-route-indicator-badge",
  session: "session-id-badge",
  project: "project-chip",
  cwd: "cwd-chip",
  mode: "permission-mode-chip",
  model: "model-chip",
  effort: "effort-chip",
} as const;

// Table T01 — the exact chip set each route shows.
const EXPECTED_CHIPS: Readonly<Record<string, ReadonlyArray<keyof typeof CHIP>>> = {
  [ROUTE_CODE]: ["identity", "session", "project", "mode", "model", "effort"],
  [ROUTE_SHELL]: ["identity", "project", "cwd"],
  [ROUTE_BTW]: ["identity", "session", "project"],
};
const ALL_CHIPS = Object.keys(CHIP) as Array<keyof typeof CHIP>;

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

/** Block until the route popup trigger reads `route`'s label. */
async function waitForRoute(app: App, route: string): Promise<void> {
  const label = LABEL_BY_ROUTE[route];
  await app.waitForCondition<boolean>(
    `(function(){
      var lbl = document.querySelector(${JSON.stringify(ROUTE_LABEL)});
      return lbl !== null && lbl.textContent.trim() === ${JSON.stringify(label)};
    })()`,
    { timeoutMs: 4000 },
  );
}

/** Which chips (of the full set) are currently mounted. */
async function mountedChips(app: App): Promise<string[]> {
  const present = await app.evalJS<string[]>(
    `(function(){
      var slots = ${JSON.stringify(ALL_CHIPS.map((k) => CHIP[k]))};
      return slots.filter(function(s){
        return document.querySelector(${JSON.stringify(CARD)} + ' [data-slot="' + s + '"]') !== null;
      });
    })()`,
  );
  return present;
}

/** Rects of the flanking cells: the leading Z4A route popup and the trailing
 *  Z5 submit button. The popup trigger is width-stabilized to the widest
 *  route label, so its width is invariant across routes too — the whole cell
 *  (left edge AND width) and the submit's right edge all stay put when the
 *  Z4B cluster resizes. */
async function flankingRects(
  app: App,
): Promise<{ groupLeft: number; groupWidth: number; submitRight: number } | null> {
  return app.evalJS<{ groupLeft: number; groupWidth: number; submitRight: number } | null>(
    `(function(){
      var g = document.querySelector(${JSON.stringify(ROUTE_TRIGGER)});
      var s = document.querySelector(${JSON.stringify(SUBMIT)});
      if (!g || !s) return null;
      var gr = g.getBoundingClientRect();
      var sr = s.getBoundingClientRect();
      return { groupLeft: gr.left, groupWidth: gr.width, submitRight: sr.right };
    })()`,
  );
}

/** Open the route popup and pick `route`, then block until it takes. */
async function clickRouteSegment(app: App, route: string): Promise<void> {
  await app.click(ROUTE_TRIGGER);
  await app.click(`.tug-menu-item[data-item-id="${route}"]`);
  await waitForRoute(app, route);
}

/** Flip the route via the ⇧⌘B keybinding (btw), driven synthetically. */
async function keybindToBtw(app: App): Promise<void> {
  await app.nativeClickAtElement(PROMPT);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT)})`,
    { timeoutMs: 2000 },
  );
  await app.evalJS<boolean>(
    `(function(){
      var target = document.activeElement || document;
      return target.dispatchEvent(new KeyboardEvent("keydown", {
        code: "KeyB", key: "B", metaKey: true, shiftKey: true,
        bubbles: true, cancelable: true, composed: true,
      }));
    })()`,
  );
  await waitForRoute(app, ROUTE_BTW);
}

describe.skipIf(!SHOULD_RUN)(
  "AT0215: three-route Session card — manifest, geometry, btw round-trip",
  () => {
    test(
      "per-route chip sets, unmoved flanking cells, and a btw ask that never touches the transcript",
      async () => {
        const app = await launchTugApp({ testName: "at0215-route-chrome" });
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

          // --- Table T01: the default (code) route shows its chip set. ---
          await waitForRoute(app, ROUTE_CODE);
          expect(
            (await mountedChips(app)).sort(),
            "code route chips (Table T01)",
          ).toEqual(EXPECTED_CHIPS[ROUTE_CODE].map((k) => CHIP[k]).sort());

          // Baseline geometry of the edge-pinned flanking cells.
          const codeRects = await flankingRects(app);
          expect(codeRects).not.toBeNull();

          // --- Flip to Shell (route popup → Shell). ---
          await clickRouteSegment(app, ROUTE_SHELL);
          expect(
            (await mountedChips(app)).sort(),
            "shell route chips (Table T01) — no Claude-session chips, Cwd present",
          ).toEqual(EXPECTED_CHIPS[ROUTE_SHELL].map((k) => CHIP[k]).sort());

          // Risk R04: the leading route popup (left edge AND width — it is
          // width-stabilized) and the trailing submit's right edge did NOT
          // move when the Z4B cluster shrank.
          const shellRects = await flankingRects(app);
          expect(shellRects).not.toBeNull();
          expect(Math.abs(shellRects!.groupLeft - codeRects!.groupLeft)).toBeLessThanOrEqual(1);
          expect(Math.abs(shellRects!.groupWidth - codeRects!.groupWidth)).toBeLessThanOrEqual(1);
          expect(Math.abs(shellRects!.submitRight - codeRects!.submitRight)).toBeLessThanOrEqual(1);

          // --- Flip to btw (⇧⌘B keybinding). ---
          await keybindToBtw(app);
          // The `/btw` placard opens the MOMENT the route flips to `?` ([P02])
          // — before any submission (the route flip dispatches a bare `/btw`,
          // which toggles the shared Z2 placard open on the side-question body).
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-slot="side-question-body"]') !== null`,
            { timeoutMs: 4000 },
          );
          expect(
            (await mountedChips(app)).sort(),
            "btw route chips (Table T01) — Claude identity, Session, Project",
          ).toEqual(EXPECTED_CHIPS[ROUTE_BTW].map((k) => CHIP[k]).sort());

          const btwRects = await flankingRects(app);
          expect(btwRects).not.toBeNull();
          expect(Math.abs(btwRects!.groupLeft - codeRects!.groupLeft)).toBeLessThanOrEqual(1);
          expect(Math.abs(btwRects!.groupWidth - codeRects!.groupWidth)).toBeLessThanOrEqual(1);
          expect(Math.abs(btwRects!.submitRight - codeRects!.submitRight)).toBeLessThanOrEqual(1);

          // --- `?`-route submit → side-question overlay, transcript untouched. ---
          const countEntries = () =>
            app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(TRANSCRIPT_ENTRIES)}).length`,
            );
          const baseline = await countEntries();
          expect(baseline).toBeGreaterThan(0);

          // On the btw route, the submission itself is the side question
          // ([P02]) — no `/btw` prefix typed. Cmd+Return forces submit.
          await app.nativeClickAtElement(PROMPT);
          await app.nativeType("what did I just say");
          await new Promise((r) => setTimeout(r, 150));
          await app.nativeKey("Enter", ["cmd"]);

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SIDE_Q_ASK)}) !== null`,
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
