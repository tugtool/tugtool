/**
 * at0333-follow-bottom-unattributed.test.ts — the scroll attribution
 * doctrine, pinned behaviorally: every scroll the machine cannot attribute
 * belongs to the user, and no deferred scroll write survives a user gesture.
 *
 * A native scrollbar drag delivers NO pointer or wheel events to the
 * container in WKWebView — SmartScroll's phase machine sits in `idle` while
 * the user scrubs. These tests drive `scrollTop` by direct assignment
 * (attribution-identical to that scrollbar silence) and assert the machine
 * answers the way the doctrine demands:
 *
 * | Test                | What would break without it                        |
 * |---------------------|----------------------------------------------------|
 * | disengage           | follow-bottom stays engaged through a scrollbar    |
 * |                     | scrub, and the next streamed turn's growth pin     |
 * |                     | slams the reader back to the bottom                |
 * | correction supersede| a two-pass turn-step correction armed before the   |
 * |                     | user moved fires late and snaps them back to the   |
 * |                     | stale target                                       |
 * | re-engage           | an unattributed scroll INTO the at-bottom band     |
 * |                     | fails to re-engage follow-bottom, so streaming     |
 * |                     | stops tracking the live edge                       |
 *
 * Growth pins are provoked by streaming a real turn into the seeded session
 * (`driveSession` ingest — the same channel live streaming uses), never by
 * synthetic DOM mutation.
 *
 * @covers tugdeck/src/lib/smart-scroll.ts
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 300_000;
const FEED_CODE_OUTPUT = 0x40;

const SID = "at0333-A";
const TURNS = 60;
const SCROLLER = '[data-tug-scroll-key="session-card-transcript"]';
const JUMP_BUTTON = ".session-jump-to-bottom-button";

/** SmartScroll's at-bottom jitter band; an upward move must clear it to
 *  count as leaving the bottom. */
const AT_BOTTOM_PX = 60;

function deckShape(): Record<string, unknown> {
  return {
    cards: [
      { id: "A", componentId: "session", title: "Session", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 760 },
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

function replyText(n: number): string {
  return [
    `## step ${n}`,
    "",
    `Reply number ${n}. The band is measured from the canvas, not observed,`,
    "so the offset re-resolves on reflow and the row keeps its height.",
    "",
    `- marker ${n}`,
  ].join("\n");
}

/** Stream one committed prompt→reply turn into the bound session. */
async function seedTurn(app: App, n: number): Promise<void> {
  const frame = (decoded: Record<string, unknown>): Promise<unknown> =>
    app.driveSession("A", {
      op: "ingestFrame",
      feedId: FEED_CODE_OUTPUT,
      decoded: { tug_session_id: SID, ...decoded },
    });
  const msgId = `${SID}-m${n}`;
  await app.driveSession("A", { op: "send", text: `prompt ${n}` });
  await frame({ type: "prompt_anchor", promptUuid: `${SID}-u${n}` });
  await frame({
    type: "content_block_start",
    msg_id: msgId,
    block_index: 0,
    kind: "text",
  });
  await frame({
    type: "assistant_text",
    msg_id: msgId,
    block_index: 0,
    text: replyText(n),
    is_partial: false,
  });
  await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
}

/** Launch, seed a tall transcript, and wait until eviction has armed —
 *  the list is settled and follow-bottom is engaged at the live edge. */
async function standUp(testName: string): Promise<App> {
  const app = await launchTugApp({ testName });
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.bindSession("A", { tugSessionId: SID });
  await app.awaitEngineReady("A", { timeoutMs: 20_000 });
  for (let n = 0; n < TURNS; n += 1) {
    await seedTurn(app, n);
  }
  await app.waitForCondition<boolean>(
    `!!document.querySelector('${SCROLLER}[data-evict-active]')`,
    { timeoutMs: 30_000 },
  );
  await new Promise((r) => setTimeout(r, 500));
  return app;
}

interface ScrollSnap {
  top: number;
  maxScroll: number;
  buttonVisible: string | null;
}

function readSnap(app: App): Promise<ScrollSnap> {
  return app.evalJS<ScrollSnap>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  var btn = document.querySelector('${JUMP_BUTTON}');
  return {
    top: el.scrollTop,
    maxScroll: el.scrollHeight - el.clientHeight,
    buttonVisible: btn === null ? null : btn.getAttribute("data-visible"),
  };
})()`);
}

describe.skipIf(!SHOULD_RUN)("AT0333: unattributed scroll attribution", () => {
  test(
    "an idle upward scroll disengages follow-bottom and growth pins stay away",
    async () => {
      const app = await standUp("at0333-disengage");
      try {
        const atBottom = await readSnap(app);
        expect(atBottom.maxScroll - atBottom.top).toBeLessThanOrEqual(4);

        // Leave the bottom the way a native scrollbar drag does: a bare
        // scrollTop assignment, no pointer or wheel events. The phase
        // machine is `idle` with no programmatic suppression armed, so
        // the doctrine attributes this to the user.
        const assigned = await app.evalJS<number>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  el.scrollTop = el.scrollTop - ${AT_BOTTOM_PX * 15};
  return el.scrollTop;
})()`);
        expect(atBottom.top - assigned).toBeGreaterThan(AT_BOTTOM_PX);
        await new Promise((r) => setTimeout(r, 500));
        const scrolledUp = await readSnap(app);
        expect(scrolledUp.buttonVisible).toBe("true");

        // Watch scrollTop while a real streamed turn lands below — the
        // growth-pin channel. Disengaged, the pin must stay away.
        await app.evalJS<boolean>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  window.__at0333 = { maxSeen: el.scrollTop };
  window.__at0333Timer = setInterval(function () {
    var e = document.querySelector('${SCROLLER}');
    if (e !== null && e.scrollTop > window.__at0333.maxSeen) {
      window.__at0333.maxSeen = e.scrollTop;
    }
  }, 16);
  return true;
})()`);
        await seedTurn(app, TURNS);
        await new Promise((r) => setTimeout(r, 1000));

        const result = await app.evalJS<{
          maxSeen: number;
          finalTop: number;
          maxScroll: number;
        }>(`(function () {
  clearInterval(window.__at0333Timer);
  var el = document.querySelector('${SCROLLER}');
  return {
    maxSeen: window.__at0333.maxSeen,
    finalTop: el.scrollTop,
    maxScroll: el.scrollHeight - el.clientHeight,
  };
})()`);
        // Never re-pinned: scrollTop stayed out of the bottom band the
        // whole time, and the held position did not drift (the new turn
        // grew the document BELOW the viewport).
        expect(result.maxScroll - result.maxSeen).toBeGreaterThan(
          AT_BOTTOM_PX * 4,
        );
        expect(Math.abs(result.finalTop - assigned)).toBeLessThanOrEqual(50);
        expect((await readSnap(app)).buttonVisible).toBe("true");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a user scroll voids a pending turn-step correction — no late snap",
    async () => {
      const app = await standUp("at0333-supersede");
      try {
        // Arm a two-pass correction, then move before it can fire — all
        // in ONE synchronous block, so no commit can land in between.
        // The ⌥⌘↑ chord dispatch enters the responder chain's document-
        // level capture listener exactly as a real chord does (the same
        // route at0330's turn stepping uses). Synchronous presses outrun
        // the async re-window, so the later presses target entries that
        // are still unmounted and take the estimated-jump + post-commit-
        // correction path; the final scrollTop assignment then drifts
        // well past the supersede band before any commit runs.
        const armed = await app.evalJS<{
          afterPresses: number;
          assigned: number;
        }>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  for (var i = 0; i < 8; i += 1) {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowUp", code: "ArrowUp",
      altKey: true, metaKey: true,
      bubbles: true, cancelable: true, composed: true,
    }));
  }
  var afterPresses = el.scrollTop;
  el.scrollTop = afterPresses + 300;
  return { afterPresses: afterPresses, assigned: el.scrollTop };
})()`);
        expect(armed.assigned - armed.afterPresses).toBeGreaterThan(8);

        // Let commits settle; the voided correction must never fire.
        await app.evalJS<boolean>(`(function () {
  window.__at0333 = { minSeen: Infinity, maxSeen: -Infinity };
  window.__at0333Timer = setInterval(function () {
    var e = document.querySelector('${SCROLLER}');
    if (e === null) return;
    if (e.scrollTop < window.__at0333.minSeen) window.__at0333.minSeen = e.scrollTop;
    if (e.scrollTop > window.__at0333.maxSeen) window.__at0333.maxSeen = e.scrollTop;
  }, 16);
  return true;
})()`);
        await new Promise((r) => setTimeout(r, 1500));
        const result = await app.evalJS<{
          minSeen: number;
          maxSeen: number;
          finalTop: number;
        }>(`(function () {
  clearInterval(window.__at0333Timer);
  var el = document.querySelector('${SCROLLER}');
  return {
    minSeen: window.__at0333.minSeen,
    maxSeen: window.__at0333.maxSeen,
    finalTop: el.scrollTop,
  };
})()`);
        // The position the user chose holds: no write ever pulled
        // scrollTop back toward the stale step target (300px below the
        // band would show up in minSeen), and nothing moved it at all.
        expect(armed.assigned - result.minSeen).toBeLessThanOrEqual(50);
        expect(result.maxSeen - armed.assigned).toBeLessThanOrEqual(50);
        expect(Math.abs(result.finalTop - armed.assigned)).toBeLessThanOrEqual(
          50,
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an unattributed scroll to the bottom re-engages follow-bottom",
    async () => {
      const app = await standUp("at0333-reengage");
      try {
        // Leave the bottom (unattributed), confirm disengaged.
        await app.evalJS<number>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  el.scrollTop = el.scrollTop - ${AT_BOTTOM_PX * 15};
  return el.scrollTop;
})()`);
        await new Promise((r) => setTimeout(r, 500));
        expect((await readSnap(app)).buttonVisible).toBe("true");

        // Return to the bottom the same silent way. Landing inside the
        // at-bottom band re-engages follow-bottom — the disengage's
        // mirror, unchanged by it.
        await app.evalJS<number>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  el.scrollTop = el.scrollHeight - el.clientHeight;
  return el.scrollTop;
})()`);
        await new Promise((r) => setTimeout(r, 500));
        expect((await readSnap(app)).buttonVisible).toBe("false");

        // Streaming pins resume: the next streamed turn tracks the live
        // edge again.
        await seedTurn(app, TURNS);
        await new Promise((r) => setTimeout(r, 1000));
        const pinned = await readSnap(app);
        expect(pinned.maxScroll - pinned.top).toBeLessThanOrEqual(4);
        expect(pinned.buttonVisible).toBe("false");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
