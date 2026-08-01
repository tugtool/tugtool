/**
 * at9996-anim-island-lab.test.ts — SCRATCH lab. Reproduce the animation-event
 * burn in captivity and name the event channel (roadmap/animation-islands.md,
 * Phase 1).
 *
 * Rebuilds the release deck shape (three transcript-bearing session cards,
 * Lens pinned right, five-up), stands up running glyphs in one card, then runs
 * a cell matrix while the island meter counts animation EVENTS — starts,
 * restarts, cancels, writes reaching glyph subtrees, transitions outliving
 * their resolved duration — alongside an rAF frame-interval histogram as the
 * in-page cost proxy:
 *
 *   settled       no open work, no streaming — the floor
 *   glyphs-idle   running dot + streaming tail mounted in A, no frames flowing
 *   stream-hot    partial assistant_text into A at cadence — glyph INSIDE the
 *                 churning subtree
 *   stream-cold   same cadence into B — running glyph OUTSIDE the churn
 *   stream-quiet  stream-hot with every animation suppressed via a quiet sheet
 *                 with a :not() exemption hole (NEVER !important overlays —
 *                 roadmap/animation-islands.md#artifact) — churn-only
 *
 * Not a regression test — an instrument. The kept regression test lands in
 * Phase 3 once the channel is named.
 *
 * @covers tugdeck/src/components/tugways/internal/tug-progress-pulsing-dot.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp } from "./_harness";
import { mkTempTugbank, seedTugbankForLaunch } from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 900_000;

const FEED_CODE_OUTPUT = 0x40;

/** Settled transcript blocks pushed into EACH session card before the cells. */
const BLOCKS_PER_SESSION = Number(process.env.AT9996_BLOCKS ?? "60");
/** Milliseconds between streamed partial frames inside a hot cell. */
const CADENCE_MS = Number(process.env.AT9996_CADENCE_MS ?? "50");
/** Seconds each cell holds while the meter counts. */
const CELL_SECS = Number(process.env.AT9996_CELL_SECS ?? "8");

const SESSIONS = ["A", "B", "C"] as const;

function blockText(session: string, n: number): string {
  return [
    `## ${session} — step ${n}`,
    "",
    `Working through the ${n}th stage of the imposition. The band is measured`,
    "from the canvas, not observed, so `calc()` re-resolves on reflow.",
    "",
    "- the pin is the width on a right-side deck",
    "- every horizontal pin is emitted as `left`",
    "- a kind is a slot count and nothing else",
    "",
    "```ts",
    `const offset = ${n} / (N - 1) * Math.max(0, band - w);`,
    "```",
    "",
    "That is the whole of the rule.",
  ].join("\n");
}

function deckShape() {
  const pane = (id: string, slot: number, cardId: string) => ({
    id,
    position: { x: 40, y: 40 },
    size: { width: 800, height: 1100 },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["standard"],
    slot,
  });
  return {
    cards: [
      ...SESSIONS.map((id) => ({
        id,
        componentId: "session",
        title: "",
        closable: true,
      })),
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      ...SESSIONS.map((id, i) => pane(`p${i}`, i, id)),
      {
        id: "pLens",
        position: { x: 0, y: 0 },
        size: { width: 380, height: 1200 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Lens",
        acceptsFamilies: [],
      },
    ],
    activePaneId: "p0",
    imposition: { kind: "five-up", lens: "right" },
    hasFocus: true,
  };
}

const WEIGHT = `(function () {
  return {
    nodes: document.getElementsByTagName("*").length,
    dots: document.querySelectorAll(".tug-progress-pulsing-dot").length,
    runningDots: document.querySelectorAll(".tug-progress-pulsing-dot[data-state='running']:not([data-static])").length,
    animations: document.getAnimations().length,
    running: document.getAnimations().filter(function (a) { return a.playState === "running"; }).length,
  };
})()`;

/** One-shot census of running animations by name+target — what is actually
 *  moving inside a cell, so no cell's counters are read against an assumed
 *  population. */
const CENSUS = `(function () {
  function path(el) {
    var out = [], n = el, i = 0;
    while (n && n.nodeType === 1 && i++ < 10) {
      var c = n.className && String(n.className).split(" ")[0];
      if (c) out.unshift(c);
      n = n.parentElement;
    }
    return out.slice(-4).join(">");
  }
  var byKey = {};
  document.getAnimations().forEach(function (a) {
    if (a.playState !== "running") return;
    var t = a.effect && a.effect.target;
    var name = a.animationName || (a.transitionProperty ? "transition:" + a.transitionProperty : "waapi");
    var key = name + " @ " + (t ? path(t) : "?");
    byKey[key] = (byKey[key] || 0) + 1;
  });
  return byKey;
})()`;

/** The island meter (diag/anim-island.sh arm/read, embedded) plus an rAF
 *  frame-interval histogram. armMeter() resets everything; readMeter() sweeps
 *  and reports. */
const ARM_METER = `(function () {
  if (window.__tugAnimIsland) window.__tugAnimIsland.disarm();
  function path(el) {
    var out = [], n = el, i = 0;
    while (n && n.nodeType === 1 && i++ < 10) {
      var c = n.className && String(n.className).split(" ")[0];
      if (c) out.unshift(c);
      n = n.parentElement;
    }
    return out.slice(-6).join(">");
  }
  var S = {
    armedAt: performance.now(),
    ids: new WeakMap(), nextId: 1,
    starts: {}, cancels: {},
    openTransitions: new Map(), agedTransitions: [],
    glyphRoots: [], glyphWrites: 0, glyphObservers: [],
    frames: 0, lastFrame: 0, longFrames: 0, worstFrame: 0, rafId: 0,
  };
  function idFor(el) {
    var id = S.ids.get(el);
    if (!id) { id = S.nextId++; S.ids.set(el, id); }
    return id;
  }
  S.onAnimStart = function (e) {
    var key = idFor(e.target) + ":" + e.animationName;
    var rec = S.starts[key] || (S.starts[key] = { count: 0, path: path(e.target) });
    rec.count++;
  };
  S.onAnimCancel = function (e) {
    var key = idFor(e.target) + ":" + e.animationName;
    var rec = S.cancels[key] || (S.cancels[key] = { count: 0, path: path(e.target) });
    rec.count++;
  };
  S.onTransRun = function (e) {
    var el = e.target;
    var cs = getComputedStyle(el);
    var ms = function (v) {
      var first = String(v).split(",")[0].trim();
      var n = parseFloat(first);
      if (!isFinite(n)) return 0;
      return first.endsWith("ms") ? n : n * 1000;
    };
    S.openTransitions.set(idFor(el) + ":" + e.propertyName, {
      ref: new WeakRef(el), prop: e.propertyName, path: path(el),
      startTs: performance.now(),
      budgetMs: ms(cs.transitionDuration) + ms(cs.transitionDelay) + 750,
    });
  };
  S.onTransDone = function (e) {
    S.openTransitions.delete(idFor(e.target) + ":" + e.propertyName);
  };
  document.addEventListener("animationstart", S.onAnimStart, true);
  document.addEventListener("animationcancel", S.onAnimCancel, true);
  document.addEventListener("transitionrun", S.onTransRun, true);
  document.addEventListener("transitionend", S.onTransDone, true);
  document.addEventListener("transitioncancel", S.onTransDone, true);
  S.trackGlyphs = function () {
    document.querySelectorAll(".tug-progress-pulsing-dot").forEach(function (g) {
      if (S.ids.has(g)) return;
      idFor(g);
      S.glyphRoots.push({ ref: new WeakRef(g), path: path(g) });
      var mo = new MutationObserver(function (muts) { S.glyphWrites += muts.length; });
      mo.observe(g, { attributes: true, childList: true, subtree: true, characterData: true });
      S.glyphObservers.push(mo);
    });
  };
  S.trackGlyphs();
  (function beat(ts) {
    if (S.lastFrame > 0) {
      var d = ts - S.lastFrame;
      if (d > 25) S.longFrames++;
      if (d > S.worstFrame) S.worstFrame = d;
    }
    S.lastFrame = ts;
    S.frames++;
    S.rafId = requestAnimationFrame(beat);
  })(performance.now());
  S.disarm = function () {
    document.removeEventListener("animationstart", S.onAnimStart, true);
    document.removeEventListener("animationcancel", S.onAnimCancel, true);
    document.removeEventListener("transitionrun", S.onTransRun, true);
    document.removeEventListener("transitionend", S.onTransDone, true);
    document.removeEventListener("transitioncancel", S.onTransDone, true);
    S.glyphObservers.forEach(function (o) { o.disconnect(); });
    cancelAnimationFrame(S.rafId);
    delete window.__tugAnimIsland;
  };
  window.__tugAnimIsland = S;
  return true;
})()`;

const READ_METER = `(function () {
  var S = window.__tugAnimIsland;
  if (!S) return { error: "not armed" };
  S.trackGlyphs();
  var now = performance.now();
  S.openTransitions.forEach(function (rec, key) {
    if (now - rec.startTs > rec.budgetMs) {
      var el = rec.ref.deref();
      S.agedTransitions.push({
        prop: rec.prop, path: rec.path,
        ageMs: Math.round(now - rec.startTs),
        stillConnected: !!(el && document.contains(el)),
      });
      S.openTransitions.delete(key);
    }
  });
  var restarts = [], startsTotal = 0;
  Object.keys(S.starts).forEach(function (k) {
    startsTotal += S.starts[k].count;
    if (S.starts[k].count > 1) restarts.push({ path: S.starts[k].path, starts: S.starts[k].count });
  });
  var cancelsTotal = 0;
  Object.keys(S.cancels).forEach(function (k) { cancelsTotal += S.cancels[k].count; });
  var gone = 0;
  S.glyphRoots.forEach(function (g) {
    var el = g.ref.deref();
    if (!el || !document.contains(el)) gone++;
  });
  var elapsed = (now - S.armedAt) / 1000;
  return {
    secs: Math.round(elapsed * 10) / 10,
    fps: Math.round(S.frames / Math.max(elapsed, 0.001)),
    longFrames: S.longFrames,
    worstFrameMs: Math.round(S.worstFrame),
    starts: startsTotal,
    cancels: cancelsTotal,
    restarts: restarts.sort(function (a, b) { return b.starts - a.starts; }).slice(0, 12),
    glyphsUnmounted: gone,
    glyphSubtreeWrites: S.glyphWrites,
    agedTransitions: S.agedTransitions.slice(-12),
  };
})()`;

/** Quiet sheet with the :not() exemption hole — suppression for stream-quiet.
 *  No !important probe rules ever (roadmap/animation-islands.md#artifact). */
const QUIET_ON = `(function () {
  var s = document.createElement("style");
  s.id = "at9996-quiet";
  s.textContent = "*:not(.at9996-exempt), *::before, *::after { animation: none !important; }";
  document.head.appendChild(s);
  return document.getAnimations().filter(function (a) { return a.playState === "running"; }).length;
})()`;

const QUIET_OFF = `(function () {
  var s = document.getElementById("at9996-quiet");
  if (s) s.remove();
  return true;
})()`;

describe.skipIf(!SHOULD_RUN)("at9996 anim island lab", () => {
  test(
    "cell matrix: settled / glyphs-idle / stream-hot / stream-cold / stream-quiet",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at9996-anim-island-lab",
        env: { TUGBANK_PATH: tugbankPath },
      });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        for (const id of SESSIONS) {
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered(${JSON.stringify(id)})`,
            { timeoutMs: 8_000 },
          );
        }

        // Settled transcript weight in every card.
        for (const id of SESSIONS) {
          const sid = `at9996-${id}`;
          await app.bindSession(id, { tugSessionId: sid });
          await app.awaitEngineReady(id, { timeoutMs: 20_000 });
          await app.driveSession(id, { op: "send", text: "go" });
          // Ten blocks per message — same rendered weight, a tenth of the
          // RPC round trips.
          const PER_MSG = 10;
          for (let n = 0; n < BLOCKS_PER_SESSION; n += PER_MSG) {
            const text = Array.from(
              { length: Math.min(PER_MSG, BLOCKS_PER_SESSION - n) },
              (_, k) => blockText(id, n + k),
            ).join("\n\n");
            await app.driveSession(id, {
              op: "ingestFrame",
              feedId: FEED_CODE_OUTPUT,
              decoded: {
                type: "assistant_text",
                tug_session_id: sid,
                msg_id: `${sid}-m${n}`,
                text,
                is_partial: false,
                rev: 0,
                seq: n,
              },
            });
          }
        }
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(".tugx-md-block").length >= ${
            SESSIONS.length * Math.ceil(BLOCKS_PER_SESSION / 10)
          }`,
          { timeoutMs: 60_000 },
        );

        const report: Record<string, unknown> = {};
        const hold = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));

        const runCell = async (
          name: string,
          during?: () => Promise<void>,
        ): Promise<void> => {
          await app.evalJS<boolean>(ARM_METER);
          const t0 = Date.now();
          if (during) {
            await during();
            const left = CELL_SECS * 1000 - (Date.now() - t0);
            if (left > 0) await hold(left);
          } else {
            await hold(CELL_SECS * 1000);
          }
          const meter = await app.evalJS<Record<string, unknown>>(READ_METER);
          const census = await app.evalJS<Record<string, number>>(CENSUS);
          const weight = await app.evalJS<Record<string, number>>(WEIGHT);
          report[name] = { meter, census, weight, t0, t1: Date.now() };
          console.log(`[at9996] CELL ${name} t0=${t0} t1=${Date.now()}`);
          console.log(`[at9996] ${name} → ${JSON.stringify({ meter, census, weight })}`);
        };

        /** Stream partial assistant_text into `cardId` for the cell window at
         *  CADENCE_MS — one growing message, rev-bumped, the streaming path. */
        const streamInto = (cardId: string, msgTag: string) => {
          return async () => {
            const sid = `at9996-${cardId}`;
            const untilMs = Date.now() + CELL_SECS * 1000;
            let text = "";
            let rev = 0;
            while (Date.now() < untilMs) {
              text += ` token${rev} lorem ipsum dolor sit amet consectetur`;
              rev += 1;
              await app.driveSession(cardId, {
                op: "ingestFrame",
                feedId: FEED_CODE_OUTPUT,
                decoded: {
                  type: "assistant_text",
                  tug_session_id: sid,
                  msg_id: `${sid}-${msgTag}`,
                  text,
                  is_partial: true,
                  rev,
                  seq: BLOCKS_PER_SESSION + 10,
                },
              });
              await hold(CADENCE_MS);
            }
          };
        };

        // Cell 1 — settled floor.
        await runCell("settled");

        // Stand up running glyphs in A: an unresolved tool call renders a
        // running header dot.
        await app.driveSession("A", {
          op: "ingestFrame",
          feedId: FEED_CODE_OUTPUT,
          decoded: {
            type: "tool_use",
            tug_session_id: "at9996-A",
            msg_id: "at9996-A-tool1",
            tool_use_id: "at9996-A-tu1",
            tool_name: "Bash",
            input: { command: "sleep 600", description: "hold a running dot" },
            seq: BLOCKS_PER_SESSION + 1,
          },
        });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll("[data-card-id='A'] .tug-progress-pulsing-dot[data-state='running']:not([data-static])").length >= 1`,
          { timeoutMs: 10_000 },
        );

        // Cell 2 — glyphs running, nothing flowing.
        await runCell("glyphs-idle");

        // Cell 3 — churn INSIDE the glyph's card.
        await runCell("stream-hot", streamInto("A", "hot"));

        // Cell 4 — same churn in B; A's glyph runs outside it.
        await runCell("stream-cold", streamInto("B", "cold"));

        // Cell 5 — churn in A with all animations suppressed: churn-only.
        await app.evalJS<number>(QUIET_ON);
        await runCell("stream-quiet", streamInto("A", "quiet"));
        await app.evalJS<boolean>(QUIET_OFF);

        console.log(`[at9996] REPORT ${JSON.stringify(report)}`);
        expect(Object.keys(report).length).toBe(5);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
