/**
 * at0387-error-block-follow-bottom.test.ts — a failing tool block must
 * not release the live edge.
 *
 * Field report: a Bash block that ends with a non-zero exit — the red
 * header dot plus the error notice band under it — very often leaves
 * the transcript parked with the jump-to-bottom affordance showing,
 * mid-stream, with the user's hands nowhere near the scroller. A
 * successful block of the same shape does not.
 *
 * The drive is the report: stand a transcript up at the live edge,
 * append a Bash call, settle it with `is_error: true` and a
 * multi-line output, and ask whether follow-bottom survived. The dev
 * log's follow-bottom transitions name the culprit if it did not.
 *
 * The third test pins the instrumentation the field diagnosis needed
 * and did not have. A flip tagged `unattributed-scroll-up` says only
 * that SmartScroll could not attribute the move — without the scroller's
 * identity, the page's focus / visibility state, and the `scroll` events
 * that led there, a field report reduces to "something did this,
 * somewhere," which is exactly where the first two live captures left
 * off.
 *
 * @covers tugdeck/src/lib/smart-scroll.ts
 * @covers tugdeck/src/components/tugways/cards/blocks/bash-tool-block.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 300_000;
const FEED_CODE_OUTPUT = 0x40;

const SID = "at0387-A";
const TURNS = 60;
const SCROLLER = '[data-tug-scroll-key="session-card-transcript"]';
const JUMP_BUTTON = ".session-jump-to-bottom-button";

function deckShape(): Record<string, unknown> {
  return {
    cards: [
      { id: "A", componentId: "session", title: "Session", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 700 },
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

function frame(app: App, decoded: Record<string, unknown>): Promise<unknown> {
  return app.driveSession("A", {
    op: "ingestFrame",
    feedId: FEED_CODE_OUTPUT,
    decoded: { tug_session_id: SID, ...decoded },
  });
}

async function seedTurn(app: App, n: number): Promise<void> {
  const msgId = `${SID}-m${n}`;
  await app.driveSession("A", { op: "send", text: `prompt ${n}` });
  await frame(app, { type: "prompt_anchor", promptUuid: `${SID}-u${n}` });
  await frame(app, {
    type: "content_block_start",
    msg_id: msgId,
    block_index: 0,
    kind: "text",
  });
  await frame(app, {
    type: "assistant_text",
    msg_id: msgId,
    block_index: 0,
    text: [
      `## step ${n}`,
      "",
      `Reply number ${n}, long enough that a dozen of these overflow the`,
      "transcript scrollport and put the card genuinely at a live edge.",
      "",
      `- marker ${n}`,
    ].join("\n"),
    is_partial: false,
  });
  await frame(app, { type: "turn_complete", msg_id: msgId, result: "success" });
}

/** A real failing `just app-test` tail — long enough that the block's
 *  body is a substantial cell of its own. */
function failingOutput(): string {
  const lines = [
    "Exit code 1",
    "==> app-test instance prefix: apptest-main",
    "==> app-test bundle id: dev.tugtool.app.apptest (identity: dev.tugtool.app.apptest)",
    "swept 5 tmux socket files",
    "",
    "========================================================",
    "APP-TEST SUMMARY",
    "========================================================",
    "Sweep:          explicit-files",
    "Files run:      1",
    "Files passed:   0",
    "Files failed:   1",
    "",
    "Per-file results:",
    "  [FAIL] at0386-session-description-hover.test.ts            (1/3)",
    "",
    "Failures:",
    "  at0386-session-description-hover.test.ts",
  ];
  for (let i = 0; i < 24; i += 1) {
    lines.push(`    expect(received).toBe(expected)  # assertion ${i}`);
  }
  lines.push("VERDICT: FAIL");
  return lines.join("\n");
}

function passingOutput(): string {
  const lines = [
    "==> app-test instance prefix: apptest-main",
    "swept 5 tmux socket files",
    "",
    "APP-TEST SUMMARY",
    "Files run:      1",
    "Files passed:   1",
  ];
  for (let i = 0; i < 24; i += 1) {
    lines.push(`  [PASS] case ${i}`);
  }
  lines.push("VERDICT: PASS");
  return lines.join("\n");
}

/** One Bash call that settles either clean or with a non-zero exit. */
async function seedBashTurn(
  app: App,
  n: number,
  opts: { isError: boolean },
): Promise<void> {
  const msgId = `${SID}-b${n}`;
  const useId = `${SID}-tc${n}`;
  await app.driveSession("A", { op: "send", text: `run ${n}` });
  await frame(app, { type: "prompt_anchor", promptUuid: `${SID}-bu${n}` });
  await frame(app, {
    type: "tool_use",
    msg_id: msgId,
    tool_use_id: useId,
    tool_name: "Bash",
    input: {
      command:
        "cd /Users/kocienda/Mounts/u/src/tugtool && just app-test " +
        "at0386-session-description-hover.test.ts 2>&1 | tail -28",
    },
    seq: 1,
  });
  await new Promise((r) => setTimeout(r, 250));
  await frame(app, {
    type: "tool_result",
    tool_use_id: useId,
    is_error: opts.isError,
    output: opts.isError ? failingOutput() : passingOutput(),
  });
  // The turn does not end at the result — the assistant keeps talking
  // about the failure, which is the shape the field report sits in.
  await frame(app, {
    type: "content_block_start",
    msg_id: msgId,
    block_index: 2,
    kind: "text",
  });
  await frame(app, {
    type: "assistant_text",
    msg_id: msgId,
    block_index: 2,
    text: "The run came back non-zero. Reading the failure now.",
    is_partial: false,
  });
  await frame(app, { type: "turn_complete", msg_id: msgId, result: "success" });
}

interface Snap {
  top: number;
  maxScroll: number;
  distance: number;
  buttonVisible: string;
  /** Last follow-bottom transition in the dev log; true when none yet
   *  (the transcript scroller is constructed engaged). */
  following: boolean;
  /** The clamp counter. Per [at0335] the honest reading is `"0"` — a
   *  record means the extent floor has a hole. */
  displacements: string | null;
}

function readSnap(app: App): Promise<Snap> {
  return app.evalJS<Snap>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  var btn = document.querySelector('${JUMP_BUTTON}');
  var max = el.scrollHeight - el.clientHeight;
  var flips = window.tugDevLog.getSnapshot().entries.filter(function (e) {
    return e.source === "smart-scroll" && e.message === "follow-bottom";
  });
  return {
    top: el.scrollTop,
    maxScroll: max,
    distance: max - el.scrollTop,
    buttonVisible: (btn === null ? null : btn.getAttribute("data-visible")) || "false",
    following: flips.length === 0 ? true : !!flips[flips.length - 1].data.following,
    displacements: el.getAttribute("data-scroll-displacements"),
  };
})()`);
}

/** Eviction's height-accounting error, per swap: the ledger's charge
 *  for a departed row minus the extent it actually occupied. A nonzero
 *  `delta` IS the document-height error a browser clamp then acts on. */
function readConservation(app: App): Promise<unknown> {
  return app.evalJS(`(function () {
  var c = window.__tug.getListConservation('${SCROLLER}');
  var bad = c.events.filter(function (e) { return Math.abs(e.delta) >= 0.5; });
  return {
    swaps: c.events.length,
    floor: c.floor,
    badSwaps: bad.length,
    worst: bad.slice(-6).map(function (e) {
      return {
        departed: e.departed, delta: Math.round(e.delta * 100) / 100,
        rows: e.rows.map(function (r) {
          return r.kind + "#" + r.index + " ledger=" + Math.round(r.ledger) + " live=" + Math.round(r.live);
        }),
      };
    }),
  };
})()`);
}

/** Follow-bottom transitions in the dev log, oldest first. */
function readFollowBottom(app: App): Promise<
  { following: boolean; source: string; scrollTop: number; scrollHeight: number }[]
> {
  return app.evalJS(`(function () {
  return window.tugDevLog.getSnapshot().entries
    .filter(function (e) {
      return e.source === "smart-scroll" && e.message === "follow-bottom";
    })
    .map(function (e) {
      return {
        following: e.data.following,
        source: e.data.source,
        scrollTop: Math.round(e.data.scrollTop),
        scrollHeight: Math.round(e.data.scrollHeight),
      };
    });
})()`);
}

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
  await new Promise((r) => setTimeout(r, 600));
  return app;
}

describe.skipIf(!SHOULD_RUN)("AT0387: error block vs follow-bottom", () => {
  test(
    "a failing Bash block keeps the transcript at the live edge",
    async () => {
      const app = await standUp("at0387-error");
      try {
        const before = await readSnap(app);
        expect(before.maxScroll).toBeGreaterThan(0);
        expect(before.following).toBe(true);

        const snaps: Snap[] = [];
        for (let n = 0; n < 6; n += 1) {
          await seedBashTurn(app, n, { isError: true });
          await new Promise((r) => setTimeout(r, 700));
          snaps.push(await readSnap(app));
        }
        const sources = await readFollowBottom(app);
        note("at0387-error", {
          flips: sources,
          snaps: snaps.map(
            (s) => `d=${s.distance} btn=${s.buttonVisible} disp=${s.displacements}`,
          ),
          conservation: await readConservation(app),
        });
        const after = snaps[snaps.length - 1];
        expect(sources.filter((s) => !s.following)).toHaveLength(0);
        // [at0335] the clamp is impossible by construction; a record
        // means the extent floor has a hole under tool-block content.
        expect(after.displacements).toBe("0");
        expect(after.following).toBe(true);
        expect(after.buttonVisible).toBe("false");
        expect(after.distance).toBeLessThanOrEqual(60);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a clean Bash block keeps the transcript at the live edge",
    async () => {
      const app = await standUp("at0387-clean");
      try {
        const snaps: Snap[] = [];
        for (let n = 0; n < 6; n += 1) {
          await seedBashTurn(app, n, { isError: false });
          await new Promise((r) => setTimeout(r, 700));
          snaps.push(await readSnap(app));
        }
        const after = snaps[snaps.length - 1];
        note("at0387-clean", {
          flips: await readFollowBottom(app),
          snaps: snaps.map(
            (s) => `d=${s.distance} btn=${s.buttonVisible} disp=${s.displacements}`,
          ),
          conservation: await readConservation(app),
        });
        expect(after.following).toBe(true);
        expect(after.displacements).toBe("0");
        expect(after.buttonVisible).toBe("false");
        expect(after.distance).toBeLessThanOrEqual(60);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a flip record names the scroller and carries the scroll events behind it",
    async () => {
      const app = await standUp("at0387-record");
      try {
        // A wheel-up is the one disengage whose cause is never in doubt,
        // which makes it the honest fixture for the record's shape: if
        // the fields are wrong here they are wrong for the flip whose
        // cause IS in doubt.
        await app.evalJS<boolean>(`(function () {
  var el = document.querySelector('${SCROLLER}');
  for (var i = 0; i < 6; i += 1) {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
    el.scrollTop = Math.max(0, el.scrollTop - 400);
  }
  return true;
})()`);
        await new Promise((r) => setTimeout(r, 600));

        const flip = await app.evalJS<{
          source: string;
          following: boolean;
          scrollKey: string;
          cardId: string;
          visibility: string;
          windowFocused: boolean;
          top: number;
          dist: number;
          sinceInputMs: number | null;
          ring: string;
        } | null>(`(function () {
  var rows = window.__deckTrace.dump().filter(function (e) {
    return e.kind === "follow-bottom" && e.following === false;
  });
  if (rows.length === 0) return null;
  var e = rows[rows.length - 1];
  return {
    source: e.source, following: e.following,
    scrollKey: e.scrollKey, cardId: e.cardId,
    visibility: e.visibility, windowFocused: e.windowFocused,
    top: e.top, dist: e.dist, sinceInputMs: e.sinceInputMs, ring: e.ring,
  };
})()`);
        note("at0387-record", flip);

        expect(flip).not.toBeNull();
        expect(flip!.source).toBe("wheel-up");
        // Which scroller, in a deck that can hold several transcripts.
        expect(flip!.scrollKey).toBe("session-card-transcript");
        expect(flip!.cardId.length).toBeGreaterThan(0);
        // What the page was doing. The value is whatever the harness's
        // window state is — the contract is that it is RECORDED, since a
        // scroller the user cannot see is one they cannot have scrubbed.
        expect(typeof flip!.visibility).toBe("string");
        expect(typeof flip!.windowFocused).toBe("boolean");
        // The gesture is fresh, and the geometry is real. `dist` is read
        // at the flip, which for `wheel-up` is the wheel event itself —
        // before the movement it stands for — so it carries no lower
        // bound here; what matters is that the position is recorded.
        expect(flip!.sinceInputMs).not.toBeNull();
        expect(flip!.sinceInputMs!).toBeLessThan(5_000);
        expect(flip!.top).toBeGreaterThan(0);
        expect(Number.isFinite(flip!.dist)).toBe(true);
        // The ring: `Δms,top,scrollHeight,clientHeight` tuples, oldest
        // first, every Δ negative (they precede the flip). A stream of
        // samples like this is what a hand looks like; the clamp this
        // instrument exists to catch arrives as exactly one.
        const samples = flip!.ring.split("|").filter((s) => s.length > 0);
        expect(samples.length).toBeGreaterThan(1);
        for (const sample of samples) {
          const parts = sample.split(",").map(Number);
          expect(parts).toHaveLength(4);
          expect(parts[0]!).toBeLessThanOrEqual(0);
          expect(parts[2]!).toBeGreaterThan(0);
          expect(parts[3]!).toBeGreaterThan(0);
        }
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
