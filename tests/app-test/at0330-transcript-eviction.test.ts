/**
 * at0330-transcript-eviction.test.ts — the session transcript renders through
 * `evictOffscreen`: rows more than a viewport from the scrollport are
 * UNMOUNTED, their exact measured heights standing in the list's spacers.
 *
 * The mode's whole claim is that this is invisible, so the assertions are
 * about what the user would notice if it weren't:
 *
 * | Test                | What would break without it                          |
 * |---------------------|------------------------------------------------------|
 * | far-scroll fidelity | blank viewport, or content at the wrong scroll offset |
 * | Z0 stays topmost    | the permanent top row painted mid-transcript, because |
 * |                     | the top spacer grew underneath it                     |
 * | selection pin       | the row holding a selection unmounted out from under  |
 * |                     | it while the user scrolled elsewhere ([L23])          |
 * | tool-block expand   | a gesture on a row near the window edge losing its    |
 * |                     | block, or the document mis-sizing after the re-measure|
 * | no suspensions      | the mode silently falling back to mounting everything |
 *
 * The transcript is seeded with COMPLETE TURNS, not with many messages in one
 * turn: consecutive assistant messages inside a turn coalesce into a single
 * assistant-run row, so row count comes from turns.
 *
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/internal/list-view-window.ts
 * @covers tugdeck/src/components/tugways/internal/list-view-height-index.ts
 * @covers tugdeck/src/components/tugways/cards/session-card-transcript.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 300_000;
const FEED_CODE_OUTPUT = 0x40;

const SID = "at0330-A";
const TURNS = 60;
const SCROLLER = '[data-tug-scroll-key="session-card-transcript"]';

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

/** Seed `turns` committed prompt→reply turns; every third one holds a tool
 *  block, so an expand gesture has something to open. */
async function seedTurns(app: App, turns: number): Promise<void> {
  const frame = (decoded: Record<string, unknown>): Promise<unknown> =>
    app.driveSession("A", {
      op: "ingestFrame",
      feedId: FEED_CODE_OUTPUT,
      decoded: { tug_session_id: SID, ...decoded },
    });
  for (let n = 0; n < turns; n += 1) {
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
    if (n % 3 === 0) {
      const tuId = `${SID}-tu${n}`;
      await frame({
        type: "tool_use",
        msg_id: msgId,
        tool_use_id: tuId,
        tool_name: "Bash",
        input: { command: `echo step ${n}`, description: `step ${n}` },
      });
      await frame({
        type: "tool_result",
        tool_use_id: tuId,
        output: `step ${n} done`,
        is_error: false,
      });
    }
    await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
  }
}

/** Launch, seed, and wait until eviction has armed. */
async function standUp(testName: string): Promise<App> {
  const app = await launchTugApp({ testName });
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.bindSession("A", { tugSessionId: SID });
  await app.awaitEngineReady("A", { timeoutMs: 20_000 });
  await seedTurns(app, TURNS);
  await app.waitForCondition<boolean>(
    `!!document.querySelector('${SCROLLER}[data-evict-active]')`,
    { timeoutMs: 30_000 },
  );
  return app;
}

/** Scroll to a fraction of the range and let the window settle. */
async function scrollTo(app: App, frac: number): Promise<void> {
  await app.evalJS<number>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * ${frac});
  return el.scrollTop;
})()`);
  await new Promise((r) => setTimeout(r, 500));
}

describe.skipIf(!SHOULD_RUN)("AT0330: transcript DOM eviction", () => {
  test(
    "far scroll keeps the viewport populated, contiguous, and Z0-topped",
    async () => {
      const app = await standUp("at0330-far-scroll");
      try {
        // Mid-transcript: rows must cover the viewport with no hole.
        for (const frac of [0.5, 0.85, 0.15]) {
          await scrollTo(app, frac);
          const view = await app.evalJS<{
            cells: number;
            contiguous: boolean;
            coversViewport: boolean;
            evicting: boolean;
          }>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  var cells = Array.prototype.slice.call(el.querySelectorAll("[data-tug-list-cell-index]"));
  var ix = cells.map(function (c) { return Number(c.getAttribute("data-tug-list-cell-index")); });
  var contiguous = ix.every(function (v, i) { return i === 0 || v === ix[i - 1] + 1; });
  var box = el.getBoundingClientRect();
  var gap = parseFloat(getComputedStyle(el.querySelector(".tug-list-view-window")).rowGap) || 0;
  // Walk the mounted rows down the scrollport looking for a band nothing
  // covers. The inter-row gap is legitimately blank; anything wider is an
  // evicted row's spacer showing through where a row should be.
  var edge = box.top;
  var hole = 0;
  cells.forEach(function (c) {
    var r = c.getBoundingClientRect();
    if (r.bottom <= box.top || r.top >= box.bottom) return;
    hole = Math.max(hole, Math.max(0, Math.min(r.top, box.bottom) - edge));
    edge = Math.max(edge, Math.min(r.bottom, box.bottom));
  });
  hole = Math.max(hole, box.bottom - edge);
  return {
    cells: cells.length,
    contiguous: contiguous,
    noBlankBand: hole <= gap + 2,
    holePx: Math.round(hole),
    gapPx: Math.round(gap),
    evicting: el.hasAttribute("data-evict-active"),
  };
})()`);
          expect({ frac, ...view }).toMatchObject({
            evicting: true,
            contiguous: true,
            noBlankBand: true,
          });
        }

        // At the very top, the permanent Z0 row is the first thing in the
        // scroll content — above the top spacer, not buried by it.
        await scrollTo(app, 0);
        const top = await app.evalJS<{
          firstSlot: string | null;
          leadingTop: number;
          firstCellIndex: number;
          spacerTop: number;
        }>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  var kids = Array.prototype.filter.call(el.children, function (k) {
    return !k.classList.contains("tug-list-view-ring");
  });
  var lead = el.querySelector(".tug-list-view-leading");
  var firstCell = el.querySelector("[data-tug-list-cell-index]");
  var box = el.getBoundingClientRect();
  return {
    firstSlot: kids.length ? kids[0].getAttribute("data-slot") || kids[0].className : null,
    leadingTop: lead ? Math.round(lead.getBoundingClientRect().top - box.top) : -9999,
    firstCellIndex: firstCell ? Number(firstCell.getAttribute("data-tug-list-cell-index")) : -1,
    spacerTop: Math.round(parseFloat(el.querySelector(".tug-list-view-spacer--top").style.height) || 0),
  };
})()`);
        expect(top.firstSlot).toBe("tug-list-view-leading");
        expect(top.firstCellIndex).toBe(0);
        expect(top.spacerTop).toBe(0);
        // Z0 sits at the top of the scrollport, not pushed below a spacer.
        expect(Math.abs(top.leadingTop)).toBeLessThanOrEqual(2);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a selected row stays mounted while the viewport travels away ([L23])",
    async () => {
      const app = await standUp("at0330-selection-pin");
      try {
        await scrollTo(app, 0.9);
        // Select inside a row that is currently mounted near the bottom.
        const picked = await app.evalJS<number>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  var cells = Array.prototype.slice.call(el.querySelectorAll("[data-tug-list-cell-index]"));
  var box = el.getBoundingClientRect();
  var target = null;
  cells.forEach(function (c) {
    var r = c.getBoundingClientRect();
    if (target === null && r.top >= box.top && r.bottom <= box.bottom) target = c;
  });
  if (target === null) target = cells[Math.floor(cells.length / 2)];
  var range = document.createRange();
  range.selectNodeContents(target);
  var sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return Number(target.getAttribute("data-tug-list-cell-index"));
})()`);
        expect(picked).toBeGreaterThanOrEqual(0);
        // Selection changes are observed off `selectionchange`, which is
        // dispatched asynchronously.
        await new Promise((r) => setTimeout(r, 300));

        await scrollTo(app, 0);
        const held = await app.evalJS<{
          mounted: boolean;
          collapsed: boolean;
          evicting: boolean;
        }>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  var sel = document.getSelection();
  return {
    mounted: !!el.querySelector('[data-tug-list-cell-index="${picked}"]'),
    collapsed: sel === null || sel.isCollapsed,
    evicting: el.hasAttribute("data-evict-active"),
  };
})()`);
        expect(held.collapsed).toBe(false);
        expect(held.mounted).toBe(true);
        // The pin widens the window; it does not switch eviction off.
        expect(held.evicting).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "expanding and collapsing a tool block round-trips the document height",
    async () => {
      const app = await standUp("at0330-expand-roundtrip");
      try {
        await scrollTo(app, 0.5);
        const before = await app.evalJS<{ h: number; headers: number }>(
          `(function () {
  var el = document.querySelector('${SCROLLER}');
  return {
    h: el.scrollHeight,
    headers: el.querySelectorAll('.tool-call-header[data-collapsed="true"]').length,
  };
})()`,
        );
        expect(before.headers).toBeGreaterThan(0);

        await app.evalJS<boolean>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  // The disclosure cue owns the toggle, not the header strip.
  el.querySelector('.tool-call-header[data-collapsed="true"] [data-slot="tool-call-header-disclosure"]').click();
  return true;
})()`);
        await new Promise((r) => setTimeout(r, 600));
        const expanded = await app.evalJS<{ h: number; open: number }>(
          `(function () {
  var el = document.querySelector('${SCROLLER}');
  return {
    h: el.scrollHeight,
    open: el.querySelectorAll('.tool-call-header:not([data-collapsed="true"])').length,
  };
})()`,
        );
        expect(expanded.open).toBeGreaterThan(0);
        expect(expanded.h).toBeGreaterThan(before.h);

        await app.evalJS<boolean>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  el.querySelector('.tool-call-header:not([data-collapsed="true"]) [data-slot="tool-call-header-disclosure"]').click();
  return true;
})()`);
        await new Promise((r) => setTimeout(r, 600));
        const after = await app.evalJS<{ h: number; fallbacks: number }>(
          `(function () {
  var el = document.querySelector('${SCROLLER}');
  return {
    h: el.scrollHeight,
    fallbacks: Number(el.getAttribute("data-evict-fallbacks") || "-1"),
  };
})()`,
        );
        // Back to the height it had before the gesture: the re-measure
        // reached the ledger, so the spacers report the collapsed row again.
        expect(Math.abs(after.h - before.h)).toBeLessThanOrEqual(2);
        expect(after.fallbacks).toBe(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
