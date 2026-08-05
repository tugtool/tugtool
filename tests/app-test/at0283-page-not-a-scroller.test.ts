/**
 * at0283-page-not-a-scroller.test.ts — the page has no scroll range, ever.
 *
 * The deck contains no scroller: panes are placed, not scrolled past. But a
 * pane parked so its frame reaches past a window edge overflows the deck root,
 * and because `#deck-container` is unpositioned that overflow resolves against
 * the viewport and lands in `<body>`'s scroll box — invisible under
 * `overflow: hidden`, and still perfectly scrollable from script. That is how
 * one ⌥⌘↑ used to slide the entire deck: `SmartScroll.scrollToElement` called
 * `Element.scrollIntoView`, which walks every scrollable ancestor of its
 * target, found the page, and spent its range. Every card's title bar parked
 * above the window top with no scrollbar, no wheel target, and no gesture that
 * brought it back.
 *
 * Two independent laws are pinned here, and the pane is deliberately parked
 * past the window bottom so both are actually under load:
 *
 *  1. STRUCTURAL — the deck root is `overflow: clip`, which clips at the same
 *     box as `hidden` but forms no scroll container, so the page's range is
 *     zero rather than merely hidden. Nothing can spend what does not exist.
 *  2. BEHAVIORAL — a scroller scrolls itself and no one else, so the turn-step
 *     chord moves the transcript while the deck stays exactly where it was.
 *
 * @covers tugdeck/src/lib/smart-scroll.ts
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 * @covers tugdeck/src/components/tugways/internal/list-view-page-navigation.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 30_000;

const CARD_ID = "A";
const SID = "b3d0c1ea-0000-4000-8000-0000000005c0";
const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const TRANSCRIPT_SELECTOR = `[data-card-id="${CARD_ID}"] [data-tug-scroll-key="session-card-transcript"]`;
const PANE_SELECTOR = `[data-card-id="${CARD_ID}"]`;

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0283-deck-scroll-"));
});
afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// One pane, parked so its bottom edge falls past the window, so the canvas
// overflows the viewport and the document scroller has real range to be stolen.
function deckShape() {
  return {
    cards: [
      { id: CARD_ID, componentId: "session", title: "Session", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 900 },
        size: { width: 820, height: 620 },
        cardIds: [CARD_ID],
        activeCardId: CARD_ID,
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

const userMsg = (text: string) => ({
  type: "add_user_message",
  tug_session_id: SID,
  content: [{ type: "text", text }],
});
const asstText = (msgId: string, text: string) => ({
  type: "assistant_text",
  tug_session_id: SID,
  msg_id: msgId,
  text,
  is_partial: false,
  rev: 0,
  seq: 0,
});
const turnDone = (msgId: string) => ({
  type: "turn_complete",
  tug_session_id: SID,
  msg_id: msgId,
  result: "success",
});
const replayStarted = () => ({ type: "replay_started", tug_session_id: SID });
const replayComplete = (count: number) => ({
  type: "replay_complete",
  tug_session_id: SID,
  count,
  firstLoadedTurnIndex: 0,
  totalTurns: count,
  hasOlder: false,
});

/**
 * `[pageScrollTop, paneTopInViewport]` — the two reads that catch a scoot.
 *
 * The page offset is the max of `<html>` and `<body>`: `globals.css` hides
 * overflow on both, and which of them ends up holding the deck's range depends
 * on the propagation rules, so neither one alone is the answer.
 */
async function deckPosition(app: App): Promise<[number, number]> {
  return app.evalJS<[number, number]>(
    `(function(){
      var pane = document.querySelector(${JSON.stringify(PANE_SELECTOR)});
      return [
        Math.max(document.documentElement.scrollTop, document.body.scrollTop),
        pane ? Math.round(pane.getBoundingClientRect().top) : -1,
      ];
    })()`,
  );
}

async function transcriptScrollTop(app: App): Promise<number> {
  return app.evalJS<number>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(TRANSCRIPT_SELECTOR)});
      return el ? Math.round(el.scrollTop) : -1;
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)("at0283 — the page is not a scroller", () => {
  test(
    "a turn-step chord scrolls the transcript and leaves the canvas put",
    async () => {
      const app = await launchTugApp({ testName: "at0283-page-not-a-scroller" });
      const ingest = (decoded: unknown) =>
        app.driveSession(CARD_ID, {
          op: "ingestFrame",
          feedId: CODE_OUTPUT_FEED,
          decoded,
        });
      try {
        // `isEngineReady` reads a deck-trace event — the trace has to be on
        // before the card mounts or the ready signal is never recorded.
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: CARD_ID });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
          { timeoutMs: 5_000 },
        );
        await app.bindSession(CARD_ID, {
          tugSessionId: SID,
          sessionMode: "resume",
          projectDir,
        });
        await app.awaitEngineReady(CARD_ID, { timeoutMs: 5_000 });

        // Enough turns that the transcript overflows its scrollport and the
        // chord has somewhere to step.
        await ingest(replayStarted());
        for (let i = 0; i < 12; i += 1) {
          await ingest(userMsg(`prompt number ${i}`));
          await ingest(asstText(`m${i}`, `reply number ${i}\n`.repeat(20)));
          await ingest(turnDone(`m${i}`));
        }
        await ingest(replayComplete(12));
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(TRANSCRIPT_SELECTOR)});
            return el !== null && el.scrollHeight > el.clientHeight + 200;
          })()`,
          { timeoutMs: 5_000 },
        );

        // Law 1 (structural): the page has NO range, even though a pane hangs
        // past the window bottom. `overflow: clip` on the deck root is what
        // makes this zero instead of 267.
        const pageRange = await app.evalJS<number>(
          `(function(){
            var de = document.documentElement, b = document.body;
            return Math.max(
              de.scrollHeight - de.clientHeight,
              b.scrollHeight - b.clientHeight,
            );
          })()`,
        );
        expect(pageRange).toBe(0);

        const [pageBefore, paneTopBefore] = await deckPosition(app);
        expect(pageBefore).toBe(0);
        const transcriptBefore = await transcriptScrollTop(app);

        // ⌥⌘↑ — the turn-step chord, dispatched key-card-scoped with focus
        // parked outside the transcript (no card focused, in the user's terms).
        await app.nativeKey("ArrowUp", ["alt", "cmd"]);
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(TRANSCRIPT_SELECTOR)});
            return el !== null && Math.round(el.scrollTop) !== ${transcriptBefore};
          })()`,
          { timeoutMs: 5_000 },
        );

        // Law 2 (behavioral): the transcript moved; the deck did not.
        const [pageAfter, paneTopAfter] = await deckPosition(app);
        expect(pageAfter).toBe(0);
        expect(paneTopAfter).toBe(paneTopBefore);

        // And the chord keeps working: a second press must not scoot either.
        await app.nativeKey("ArrowUp", ["alt", "cmd"]);
        const [pageAfter2, paneTopAfter2] = await deckPosition(app);
        expect(pageAfter2).toBe(0);
        expect(paneTopAfter2).toBe(paneTopBefore);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0283] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
