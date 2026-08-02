/**
 * at0098-rewind-mount-identity.test.ts — the [L26] pin for `/rewind`'s local
 * conversation truncation ([#step-7-3]).
 *
 * Conversation rewind truncates the transcript LOCALLY (7b.2 respawns
 * silently — no replay rebuild). The survivors must keep their React
 * reconciliation identity so their mounts are preserved: no remount, so
 * scroll position, selection, and any DOM-resident state stay intact ([L26],
 * the complement to [L23]).
 *
 * The canonical L26 regression here (per `session-card-transcript.tsx`) is the
 * cell wrapper unmounting on a transcript mutation, which "silently clamped
 * `scrollTop` to 0" and discarded selection. So this test asserts the
 * user-visible guarantees the plan names: a text selection in a surviving
 * (pre-rewind) turn and a non-zero scroll position both survive a conversation
 * rewind that drops a LATER turn. A remount would lose either. (Raw DOM-node
 * identity is deliberately NOT asserted — `TugListView` windows and reuses
 * cells, so node identity is a property of the virtualizer, not of L26.)
 *
 * The rewind is driven by injecting the `rewind_result` ack — the local
 * truncation is a store/data-source concern, exercised here independently of
 * the sheet (the sheet round-trip is at0097). Deterministic; no live claude.
 *
 * Nothing here counts rows: the transcript evicts settled offscreen rows to
 * measured-height placeholders, so the DOM holds the window, not the session.
 * Presence is asserted near the scrollport, and the truncation itself is read
 * off the scroll height — the spine that eviction preserves exactly.
 *
 * @covers tugdeck/src/lib/code-session-store/
 * @covers tugdeck/src/components/tugways/cards/session-card-transcript.tsx
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0098-session";
const FEED_CODE_OUTPUT = 0x40;
const TURNS = 8;

const CARD = '[data-card-id="A"]';
const USER_ROWS = `${CARD} [data-testid="session-card-transcript-user-body"]`;
// The scrollable element is the TugListView viewport, keyed by its
// `scrollKey` — NOT the `data-slot` wrapper around it.
const TRANSCRIPT = `${CARD} [data-tug-scroll-key="session-card-transcript"]`;

/**
 * The turn numbers whose user row is CURRENTLY in the DOM, read out of the
 * `prompt number N` bodies this test seeds. The transcript evicts settled
 * offscreen rows, so this is a window onto the rendered range, not a turn
 * count — assertions phrase themselves as presence/absence near the
 * scrollport, never as a total.
 */
const RENDERED_PROMPTS_JS = `Array.prototype.map.call(
  document.querySelectorAll(${JSON.stringify(USER_ROWS)}),
  function (r) {
    var m = /prompt number (\\d+)/.exec(r.textContent || "");
    return m ? parseInt(m[1], 10) : -1;
  },
)`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
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

/** Drive one committed anchored turn with a long reply (to force overflow). */
async function buildTurn(app: App, i: number): Promise<void> {
  const uuid = `uuid-${i}`;
  const msgId = `m-${i}`;
  const reply = `reply ${i} — ${"lorem ipsum dolor sit amet ".repeat(12)}`;
  const frame = (decoded: Record<string, unknown>) =>
    app.driveSession("A", {
      op: "ingestFrame",
      feedId: FEED_CODE_OUTPUT,
      decoded: { tug_session_id: SID, ...decoded },
    });
  await app.driveSession("A", { op: "send", text: `prompt number ${i}` });
  await frame({ type: "prompt_anchor", promptUuid: uuid });
  await frame({ type: "content_block_start", msg_id: msgId, block_index: 0, kind: "text" });
  await frame({ type: "assistant_text", msg_id: msgId, block_index: 0, text: reply, is_partial: false });
  await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
}

describe.skipIf(!SHOULD_RUN)("AT0098: /rewind local truncation preserves survivor mounts ([L26])", () => {
  test(
    "rewinding a later turn preserves a surviving turn's selection (no remount) and healthy scroll",
    async () => {
      const app = await launchTugApp({ testName: "at0098-rewind-mount-identity" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        for (let i = 1; i <= TURNS; i += 1) await buildTurn(app, i);
        // Row COUNTS are not a signal here: the transcript evicts settled
        // offscreen rows to measured-height placeholders, so only the rows
        // near the scrollport are in the DOM. The list is following the
        // bottom, so the tip IS rendered — the newest turn's presence is the
        // sound "all turns built" signal.
        await app.waitForCondition<boolean>(
          `${RENDERED_PROMPTS_JS}.indexOf(${TURNS}) !== -1`,
          { timeoutMs: 12000 },
        );

        // Scroll back to a modest non-zero offset — small enough that turn 1
        // is inside the window (eviction re-materializes it), large enough to
        // distinguish "preserved" from "clamped to 0" after the rewind.
        await app.evalJS<null>(
          `(function () {
             var scroller = document.querySelector(${JSON.stringify(TRANSCRIPT)});
             if (scroller) scroller.scrollTop = 48;
             return null;
           })()`,
        );
        await app.waitForCondition<boolean>(
          `${RENDERED_PROMPTS_JS}.indexOf(1) !== -1`,
          { timeoutMs: 6000 },
        );

        // Select the first (always-surviving) turn's text.
        const before = await app.evalJS<{
          row0Text: string;
          selText: string;
          scrollTop: number;
          scrollHeight: number;
        }>(
          `(function () {
             var scroller = document.querySelector(${JSON.stringify(TRANSCRIPT)});
             var rows = document.querySelectorAll(${JSON.stringify(USER_ROWS)});
             var first = rows[0];
             var range = document.createRange();
             range.selectNodeContents(first);
             var sel = window.getSelection();
             sel.removeAllRanges();
             sel.addRange(range);
             return {
               row0Text: first.textContent || "",
               selText: sel.toString(),
               scrollTop: scroller ? scroller.scrollTop : -1,
               scrollHeight: scroller ? scroller.scrollHeight : -1,
             };
           })()`,
        );
        // Sanity: row 0 is turn 1 and is rendered (selection captured its text).
        expect(before.row0Text).toContain("prompt number 1");
        expect(before.selText).toContain("prompt number 1");
        // The transcript must actually be scrolled (overflow present) for the
        // scroll-preservation assertion below to mean anything.
        expect(before.scrollTop).toBeGreaterThan(0);

        // Apply a conversation rewind to the LAST turn — drops only turn 8,
        // keeps turns 1–7. Driven by the ack (the truncation is store-driven).
        await app.driveSession("A", {
          op: "ingestFrame",
          feedId: FEED_CODE_OUTPUT,
          decoded: {
            type: "rewind_result",
            tug_session_id: SID,
            promptUuid: `uuid-${TURNS}`,
            scope: "conversation",
            canRewind: true,
          },
        });

        // The truncation landed when the content shrinks. Scroll height is the
        // eviction-proof reading of it: the view stays parked near turn 1
        // (that is the point of the test), so the dropped turn was never on
        // screen to disappear from — but its rows' measured heights leave the
        // spine when they leave the transcript.
        await app.waitForCondition<boolean>(
          `(function () {
             var s = document.querySelector(${JSON.stringify(TRANSCRIPT)});
             return s !== null && s.scrollHeight < ${before.scrollHeight};
           })()`,
          { timeoutMs: 6000 },
        );

        // The survivor turn's selection survives and the scroll position is
        // not clamped to 0 — neither would hold across a remount ([L26]).
        const after = await app.evalJS<{
          prompts: number[];
          selText: string;
          scrollTop: number;
        }>(
          `(function () {
             var scroller = document.querySelector(${JSON.stringify(TRANSCRIPT)});
             return {
               prompts: ${RENDERED_PROMPTS_JS},
               selText: window.getSelection().toString(),
               scrollTop: scroller ? scroller.scrollTop : -1,
             };
           })()`,
        );
        // The view never left turn 1, so that is what is rendered — and the
        // dropped turn is not among the rendered rows.
        expect(after.prompts).toContain(1);
        expect(after.prompts).not.toContain(TURNS);
        // The selection in the surviving turn is intact — the definitive
        // proof that turn 1's row was NOT torn down and rebuilt ([L26]); a
        // remount collapses the selection.
        expect(after.selText).toContain("prompt number 1");
        // Scroll is healthy (not clamped to 0 — the documented remount
        // regression in session-card-transcript.tsx).
        expect(after.scrollTop).toBeGreaterThan(0);

        // The RIGHT turn was dropped: at the foot, the newest turn is 7.
        await app.evalJS<null>(
          `(function () {
             var s = document.querySelector(${JSON.stringify(TRANSCRIPT)});
             if (s) s.scrollTop = s.scrollHeight;
             return null;
           })()`,
        );
        await app.waitForCondition<boolean>(
          `Math.max.apply(null, ${RENDERED_PROMPTS_JS}) === ${TURNS - 1}`,
          { timeoutMs: 6000 },
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
