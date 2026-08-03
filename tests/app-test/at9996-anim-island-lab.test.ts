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
 *   tool-churn-hot    tool_use→tool_result pairs at cadence into A, whose
 *                     held-open tool keeps a running dot standing — does the
 *                     turn/tool lifecycle restart or re-resolve a persistent
 *                     running glyph? (E1/E2)
 *   tool-churn-cold   the same pairs into C, no standing glyph — each pair
 *                     mints, runs, settles, and static-swaps its own dot; the
 *                     settle-crossing machinery under churn (E3)
 *   tool-churn-quiet  tool-churn-hot with the quiet sheet on — churn-only
 *
 *   caret-idle          focused prompt editor, no input — does the caret blink
 *                       restart unprompted? (expect 1 start, 0 cancels)
 *   caret-typing        keystroke bursts with idle-expiry gaps — the typing
 *                       suppression's animation-name toggle (expect one
 *                       cancel/start pair per burst, never per keystroke)
 *   caret-focus-flip    blur/focus cycles — the .cm-focused animation gate
 *                       (expect exactly one pair per flip, no amplification)
 *   caret-select-cycle  select-all↔collapse cycles — CM6 LayerView's WebKit
 *                       display toggle on the emptied marker set (expect one
 *                       pair per cycle if the toggle convicts)
 *
 * Every ingest RPC runs behind a client-side timeout race AND a server-side
 * evalJS budget; every cadence loop carries a hard iteration cap (the 34k
 * stream-hot run hung forever on one ingestFrame that never returned).
 *
 * Not a regression test — an instrument. The kept regression test lands in
 * Phase 3 once the channel is named.
 *
 * The caret and soak cells launch in the activating event mode, so a run of this
 * file takes the screen.
 *
 * @covers tugdeck/src/components/tugways/internal/tug-progress-pulsing-dot.tsx
 * @foreground
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
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
/** Milliseconds per tool_use→tool_result pair in the tool-churn cells. */
const TOOL_CHURN_MS = Number(process.env.AT9996_TOOL_CHURN_MS ?? "400");
/** Client-side ceiling on any single ingest RPC. */
const INGEST_TIMEOUT_MS = 10_000;
/** Skip arming the in-page meter (no rAF heartbeat) — external sampler only. */
const NO_METER = process.env.AT9996_NO_METER === "1";
/** Comma-separated cell names to run; empty = the full matrix. */
const ONLY_CELLS = (process.env.AT9996_CELLS ?? "")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

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

/**
 * Bind every lab session and settle `blocks` markdown blocks of transcript
 * into each, ten blocks per message. The deck's rendered weight scales
 * roughly linearly (500 blocks/session ≈ 81k nodes on the standard
 * three-card shape).
 */
async function seedTranscriptWeight(
  app: App,
  blocks: number,
  prefix: string,
): Promise<void> {
  for (const id of SESSIONS) {
    await app.waitForCondition<boolean>(
      `window.__tug.assertHostRootRegistered(${JSON.stringify(id)})`,
      { timeoutMs: 8_000 },
    );
  }
  for (const id of SESSIONS) {
    const sid = `${prefix}-${id}`;
    await app.bindSession(id, { tugSessionId: sid });
    await app.awaitEngineReady(id, { timeoutMs: 20_000 });
    await app.driveSession(id, { op: "send", text: "go" });
    const PER_MSG = 10;
    for (let n = 0; n < blocks; n += PER_MSG) {
      const text = Array.from(
        { length: Math.min(PER_MSG, blocks - n) },
        (_, k) => blockText(id, n + k),
      ).join("\n\n");
      await withDeadline(
        app.driveSession(
          id,
          {
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
          },
          { timeoutMs: INGEST_TIMEOUT_MS },
        ),
        `${prefix} seed ${id} block ${n}`,
      );
    }
  }
  await app.waitForCondition<boolean>(
    `document.querySelectorAll(".tugx-md-block").length >= ${
      SESSIONS.length * Math.ceil(blocks / 10)
    }`,
    { timeoutMs: 60_000 },
  );
}

/**
 * Seed ONE session with `turns` complete prompt→reply turns, each contributing
 * a user row and an assistant row.
 *
 * {@link seedTranscriptWeight} is the wrong shape for the eviction cell:
 * consecutive assistant messages inside ONE turn coalesce into a single
 * assistant-run row, so pushing 400 messages into one turn yields two rows no
 * matter how much text it is. Eviction is measured in rows, so the weight has
 * to arrive as turns.
 */
async function seedTranscriptTurns(
  app: App,
  id: string,
  turns: number,
  prefix: string,
  /** Awaited every `sampleEvery` turns — the harness channel carries one RPC
   *  at a time, so an observer has to take its turn rather than poll. */
  onSample?: () => Promise<void>,
  sampleEvery = 15,
): Promise<void> {
  const sid = `${prefix}-${id}`;
  await app.bindSession(id, { tugSessionId: sid });
  await app.awaitEngineReady(id, { timeoutMs: 20_000 });
  const frame = (decoded: Record<string, unknown>): Promise<unknown> =>
    withDeadline(
      app.driveSession(
        id,
        {
          op: "ingestFrame",
          feedId: FEED_CODE_OUTPUT,
          decoded: { tug_session_id: sid, ...decoded },
        },
        { timeoutMs: INGEST_TIMEOUT_MS },
      ),
      `${prefix} seed ${id} frame`,
    );
  for (let n = 0; n < turns; n += 1) {
    const msgId = `${sid}-m${n}`;
    await app.driveSession(id, { op: "send", text: `step ${n}` });
    await frame({ type: "prompt_anchor", promptUuid: `${sid}-u${n}` });
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
      text: blockText(id, n),
      is_partial: false,
    });
    await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
    if (onSample !== undefined && n > 0 && n % sampleEvery === 0) {
      await onSample();
    }
  }
  // Rendered-row counting is the wrong settle signal here: under eviction most
  // rows are unmounted by design. The scroller's own height is the honest one
  // — it counts every row, mounted or evicted.
  await app.waitForCondition<boolean>(
    `(document.querySelector('[data-tug-scroll-key="session-card-transcript"]')?.scrollHeight ?? 0) > ${turns * 60}`,
    { timeoutMs: 60_000 },
  );
}

/**
 * Encode an absolute project dir the way claude names its per-project subdir
 * under `~/.claude/projects/` — mirrors tugcode's `encodeProjectDir` (every
 * character outside `[A-Za-z0-9-]` → `-`). Inline so the app-test graph does
 * not import tugcode.
 */
const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

/**
 * A minimal but claude-parseable two-turn session JSONL (the at0192 shape:
 * full `uuid`/`parentUuid`/`sessionId`/`cwd` fields, because `claude --resume`
 * reads the same file and a thin fixture reverts the card via
 * `resume_failed`). `cwd` must equal the resolved project dir.
 */
function buildResumeFixtureJsonl(cwd: string, sessionId: string): string {
  const base = {
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.105",
    gitBranch: "main",
  };
  const u1 = `${sessionId.slice(0, 24)}00000c01`;
  const a1 = `${sessionId.slice(0, 24)}00000c02`;
  const lines = [
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: u1,
      timestamp: "2026-06-17T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    },
    {
      ...base,
      parentUuid: u1,
      type: "assistant",
      uuid: a1,
      timestamp: "2026-06-17T10:00:01.000Z",
      message: {
        id: `msg-${sessionId.slice(0, 8)}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: "hi there" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 1200,
          output_tokens: 50,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 8000,
        },
      },
    },
  ];
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/**
 * Spawn a REAL tugcode-bound session into every lab card via
 * `spawn_session(mode=resume)` — tugcast spawns a genuine tugcode `--resume`
 * per card, each with a live WS feed, replaying a per-run fixture JSONL. The
 * S9 differentiator the synthetic `bindSession` path can never cover.
 * Returns the cleanup that removes the fixture + project dirs.
 */
async function seedRealResumeSessions(app: App): Promise<() => void> {
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at9996-real-")));
  const fixtureDir = join(
    homedir(),
    ".claude",
    "projects",
    encodeProjectDir(projectDir),
  );
  mkdirSync(fixtureDir, { recursive: true });
  const sids: Record<string, string> = {
    A: "a9990000-0000-4000-8000-0000000000aa",
    B: "a9990000-0000-4000-8000-0000000000bb",
    C: "a9990000-0000-4000-8000-0000000000cc",
  };
  for (const id of SESSIONS) {
    writeFileSync(
      join(fixtureDir, `${sids[id]}.jsonl`),
      buildResumeFixtureJsonl(projectDir, sids[id]),
    );
  }
  for (const id of SESSIONS) {
    await app.waitForCondition<boolean>(
      `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(id)})`,
      { timeoutMs: 15_000 },
    );
  }
  for (const id of SESSIONS) {
    await app.spawnSessionResume(id, { tugSessionId: sids[id], projectDir });
  }
  // Replay landed = each card's transcript shows the fixture's entries.
  for (const id of SESSIONS) {
    await app.waitForCondition<boolean>(
      `document.querySelectorAll('[data-card-id=${JSON.stringify(id)}] .tug-transcript-entry').length >= 2`,
      { timeoutMs: 30_000 },
    );
  }
  return () => {
    rmSync(projectDir, { recursive: true, force: true });
    if (existsSync(fixtureDir)) rmSync(fixtureDir, { recursive: true, force: true });
  };
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

/** Suppress ONE animation family; id'd so it can be removed. */
const familyQuiet = (id: string, selector: string): string => `(function () {
  var s = document.createElement("style");
  s.id = "at9996-family-${id}";
  s.textContent = ${JSON.stringify(`${selector} { animation: none !important; }`)};
  document.head.appendChild(s);
  return true;
})()`;

const familyQuietOff = (id: string): string => `(function () {
  var s = document.getElementById("at9996-family-${id}");
  if (s) s.remove();
  return true;
})()`;

/** Inject N isolated fixed-position probe divs running a given animation.
 *  Literal or var()-driven keyframes, chosen period — the null-hypothesis
 *  rig: no Tug component, no ancestors, just WebKit and a keyframes loop. */
const probeOn = (
  n: number,
  periodMs: number,
  useVar: boolean,
): string => `(function () {
  var s = document.createElement("style");
  s.id = "at9996-probe-style";
  s.textContent = [
    ${JSON.stringify("")} + (${useVar}
      ? ":root { --at9996-min: 0.72; } @keyframes at9996-probe { 0% { transform: scale(var(--at9996-min)); } 50% { transform: scale(1); } 100% { transform: scale(var(--at9996-min)); } }"
      : "@keyframes at9996-probe { 0% { transform: scale(0.72); } 50% { transform: scale(1); } 100% { transform: scale(0.72); } }"),
    ".at9996-probe { position: fixed; top: 4px; width: 8px; height: 8px; border-radius: 99px; background: #f0f; animation: at9996-probe ${periodMs}ms linear infinite; }",
  ].join("\\n");
  document.head.appendChild(s);
  for (var i = 0; i < ${n}; i++) {
    var d = document.createElement("div");
    d.className = "at9996-probe at9996-exempt";
    d.style.left = (4 + i * 12) + "px";
    d.style.animationDelay = (-i * ${periodMs} / ${n}) + "ms";
    document.body.appendChild(d);
  }
  return document.getAnimations().filter(function (a) { return a.playState === "running"; }).length;
})()`;

const PROBE_OFF = `(function () {
  document.querySelectorAll(".at9996-probe").forEach(function (d) { d.remove(); });
  var s = document.getElementById("at9996-probe-style");
  if (s) s.remove();
  return true;
})()`;

const QUIET_OFF = `(function () {
  var s = document.getElementById("at9996-quiet");
  if (s) s.remove();
  return true;
})()`;

/** Race an RPC against a client-side deadline — a transport that swallows the
 *  response fails the cell instead of hanging the run. */
const withDeadline = async <T>(p: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `[at9996] RPC deadline: ${label} exceeded ${INGEST_TIMEOUT_MS}ms`,
          ),
        ),
      INGEST_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
};

describe.skipIf(!SHOULD_RUN)("at9996 anim island lab", () => {
  test(
    "cell matrix: settled / glyphs-idle / stream-{hot,cold,quiet} / tool-churn-{hot,cold,quiet}",
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

        // A blown deadline inside a cell's drive loop is recorded, not
        // fatal — an external sampler attached to the WebContent process can
        // stall a single RPC, and one lost frame must not void the matrix.
        // Seeding stays fatal: a cell run against a half-seeded deck lies.
        let ingestTimeouts = 0;
        const ingest = async (
          cardId: string,
          decoded: Record<string, unknown>,
          label: string,
          opts?: { tolerant?: boolean },
        ): Promise<void> => {
          try {
            await withDeadline(
              app.driveSession(
                cardId,
                { op: "ingestFrame", feedId: FEED_CODE_OUTPUT, decoded },
                { timeoutMs: INGEST_TIMEOUT_MS },
              ),
              label,
            );
          } catch (err) {
            if (!opts?.tolerant) throw err;
            ingestTimeouts++;
            console.log(`[at9996] TOLERATED ${String(err)}`);
          }
        };

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
            await ingest(
              id,
              {
                type: "assistant_text",
                tug_session_id: sid,
                msg_id: `${sid}-m${n}`,
                text,
                is_partial: false,
                rev: 0,
                seq: n,
              },
              `seed ${id} block ${n}`,
            );
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
          if (ONLY_CELLS.length > 0 && !ONLY_CELLS.includes(name)) return;
          if (!NO_METER)
            await withDeadline(app.evalJS<boolean>(ARM_METER), `arm ${name}`);
          const timeouts0 = ingestTimeouts;
          const t0 = Date.now();
          if (during) {
            await during();
            const left = CELL_SECS * 1000 - (Date.now() - t0);
            if (left > 0) await hold(left);
          } else {
            await hold(CELL_SECS * 1000);
          }
          const meter = NO_METER
            ? {}
            : await withDeadline(
                app.evalJS<Record<string, unknown>>(READ_METER),
                `read ${name}`,
              );
          const census = await withDeadline(
            app.evalJS<Record<string, number>>(CENSUS),
            `census ${name}`,
          );
          const weight = await withDeadline(
            app.evalJS<Record<string, number>>(WEIGHT),
            `weight ${name}`,
          );
          report[name] = {
            meter,
            census,
            weight,
            ingestTimeouts: ingestTimeouts - timeouts0,
            t0,
            t1: Date.now(),
          };
          console.log(`[at9996] CELL ${name} t0=${t0} t1=${Date.now()}`);
          console.log(`[at9996] ${name} → ${JSON.stringify({ meter, census, weight })}`);
        };

        /** Stream partial assistant_text into `cardId` for the cell window at
         *  CADENCE_MS — one growing message, rev-bumped, the streaming path. */
        const streamInto = (cardId: string, msgTag: string) => {
          return async () => {
            const sid = `at9996-${cardId}`;
            const untilMs = Date.now() + CELL_SECS * 1000;
            const maxIters = Math.ceil((CELL_SECS * 1000) / CADENCE_MS) + 20;
            // The harness RPC transport wedges permanently when a single
            // evalJS payload crosses ~8KB (reproduced twice, both at rev
            // 162). Real frames ride the tugcast socket, not this pipe, so
            // the lab caps the growing message and rolls to a new msg_id —
            // same commit cadence, bounded payload.
            let text = "";
            let rev = 0;
            let roll = 0;
            while (Date.now() < untilMs && rev < maxIters) {
              if (text.length > 4000) {
                text = "";
                roll += 1;
              }
              text += ` token${rev} lorem ipsum dolor sit amet consectetur`;
              rev += 1;
              await ingest(
                cardId,
                {
                  type: "assistant_text",
                  tug_session_id: sid,
                  msg_id: `${sid}-${msgTag}-r${roll}`,
                  text,
                  is_partial: true,
                  rev,
                  seq: BLOCKS_PER_SESSION + 10,
                },
                `stream ${msgTag} rev ${rev}`,
                { tolerant: true },
              );
              await hold(CADENCE_MS);
            }
          };
        };

        /** tool_use→tool_result pairs at TOOL_CHURN_MS cadence — the
         *  turn/tool lifecycle the stream cells never exercised. Each pair
         *  mints a running header dot, terminates it, and drives the
         *  settle→static crossing. */
        const toolChurn = (
          cardId: string,
          tag: string,
          pairMs: number = TOOL_CHURN_MS,
        ) => {
          return async () => {
            const sid = `at9996-${cardId}`;
            const untilMs = Date.now() + CELL_SECS * 1000;
            const maxIters = Math.ceil((CELL_SECS * 1000) / pairMs) + 8;
            let i = 0;
            while (Date.now() < untilMs && i < maxIters) {
              const tuId = `${sid}-${tag}-tu${i}`;
              await ingest(
                cardId,
                {
                  type: "tool_use",
                  tug_session_id: sid,
                  msg_id: `${sid}-${tag}-m${i}`,
                  tool_use_id: tuId,
                  tool_name: "Bash",
                  input: {
                    command: `echo churn ${i}`,
                    description: `churn pair ${i}`,
                  },
                  seq: BLOCKS_PER_SESSION + 100 + i * 2,
                },
                `tool_use ${tag}#${i}`,
                { tolerant: true },
              );
              await hold(pairMs / 2);
              await ingest(
                cardId,
                {
                  type: "tool_result",
                  tug_session_id: sid,
                  tool_use_id: tuId,
                  output: `churn ${i} done`,
                  is_error: false,
                  seq: BLOCKS_PER_SESSION + 101 + i * 2,
                },
                `tool_result ${tag}#${i}`,
                { tolerant: true },
              );
              await hold(pairMs / 2);
              i++;
            }
          };
        };

        const quietOff = async () => {
          await app.evalJS<boolean>(QUIET_OFF);
          await hold(750);
        };

        // Cell 0 — the true floor: idle deck, zero running animations.
        await app.evalJS<number>(QUIET_ON);
        await runCell("settled-quiet");
        await quietOff();

        // Cell 1 — settled floor (the deck's baseline indicator animations
        // run; nothing else happens). Against settled-quiet this isolates
        // what merely HAVING running glyphs costs at weight.
        await runCell("settled");

        // Family bisection at idle: suppress one animation family at a time
        // and let the external sampler say which one ticks the main thread.
        await app.evalJS<boolean>(
          familyQuiet("wave", ".tug-progress-wave-bar"),
        );
        await runCell("settled-nowave");
        await app.evalJS<boolean>(familyQuietOff("wave"));
        await hold(750);

        await app.evalJS<boolean>(
          familyQuiet(
            "dot",
            ".tug-progress-pulsing-dot-dot, .tug-progress-pulsing-dot-ring, .tug-progress-pulsing-dot::after",
          ),
        );
        await runCell("settled-nodot");
        await app.evalJS<boolean>(familyQuietOff("dot"));
        await hold(750);

        // Null-hypothesis probes: the deck's own animations all suppressed,
        // 12 isolated fixed divs running literal keyframes at 1s vs 10s
        // periods, then var()-driven keyframes at 1s. Iteration-boundary
        // servicing predicts ~10x fewer style resolves at 10s; software
        // (per-frame) animation predicts ~60/s regardless; var() keyframes
        // forcing software predicts the third cell exploding.
        await app.evalJS<number>(QUIET_ON);
        await app.evalJS<number>(probeOn(12, 1000, false));
        await runCell("probe-literal-1s");
        await app.evalJS<boolean>(PROBE_OFF);
        await app.evalJS<number>(probeOn(12, 10000, false));
        await runCell("probe-literal-10s");
        await app.evalJS<boolean>(PROBE_OFF);
        await app.evalJS<number>(probeOn(12, 1000, true));
        await runCell("probe-var-1s");
        await app.evalJS<boolean>(PROBE_OFF);
        await quietOff();

        // Stand up running glyphs in A: an unresolved tool call renders a
        // running header dot.
        await ingest(
          "A",
          {
            type: "tool_use",
            tug_session_id: "at9996-A",
            msg_id: "at9996-A-tool1",
            tool_use_id: "at9996-A-tu1",
            tool_name: "Bash",
            input: { command: "sleep 600", description: "hold a running dot" },
            seq: BLOCKS_PER_SESSION + 1,
          },
          "hold-open tool_use A",
        );
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
        await quietOff();

        // Cell 6 — tool lifecycle beside the standing running glyph in A.
        await runCell("tool-churn-hot", toolChurn("A", "churnA"));

        // Cell 7 — tool lifecycle in C, no standing glyph: each pair mints,
        // settles, and static-swaps its own dot.
        await runCell("tool-churn-cold", toolChurn("C", "churnC"));

        // Cell 8 — the same lifecycle in A with animations suppressed.
        await app.evalJS<number>(QUIET_ON);
        await runCell("tool-churn-quiet", toolChurn("A", "churnQ"));
        await quietOff();

        // Cell 9 — pairs at quarter cadence into C: the next tool_use lands
        // while the previous dot is still mid-settle. The interruption path
        // the happy-path cells never exercise.
        await runCell("tool-churn-fast", toolChurn("C", "fast", TOOL_CHURN_MS / 4));

        // Cell 10 — the real shape of a working turn: partial text streaming
        // into A WHILE tools churn in A. Commits land in the same subtree as
        // minting/settling dots.
        await runCell("turn-mix", async () => {
          await Promise.all([
            streamInto("A", "mix")(),
            toolChurn("A", "mixT")(),
          ]);
        });

        /** Full turn cycles at a period: send → text → turn_complete → gap.
         *  The only channel that crosses the PERSISTENT dots (session status,
         *  wave footer) — inside a turn they run through tool_work and
         *  streaming alike and never settle. A period under the 260ms settle
         *  promotes those dots mid-settle every cycle. */
        const turnCycle = (cardId: string, tag: string, periodMs: number) => {
          return async () => {
            const sid = `at9996-${cardId}`;
            const untilMs = Date.now() + CELL_SECS * 1000;
            const maxIters = Math.ceil((CELL_SECS * 1000) / periodMs) + 8;
            let i = 0;
            while (Date.now() < untilMs && i < maxIters) {
              try {
                await withDeadline(
                  app.driveSession(
                    cardId,
                    { op: "send", text: `cycle ${tag} ${i}` },
                    { timeoutMs: INGEST_TIMEOUT_MS },
                  ),
                  `send ${tag}#${i}`,
                );
              } catch (err) {
                ingestTimeouts++;
                console.log(`[at9996] TOLERATED ${String(err)}`);
              }
              await ingest(
                cardId,
                {
                  type: "assistant_text",
                  tug_session_id: sid,
                  msg_id: `${sid}-${tag}-t${i}`,
                  text: `cycle ${i} reply`,
                  is_partial: false,
                  rev: 0,
                  seq: BLOCKS_PER_SESSION + 500 + i * 2,
                },
                `cycle text ${tag}#${i}`,
                { tolerant: true },
              );
              await hold(periodMs / 2);
              await ingest(
                cardId,
                {
                  type: "turn_complete",
                  tug_session_id: sid,
                  msg_id: `${sid}-${tag}-t${i}`,
                  result: "success",
                  seq: BLOCKS_PER_SESSION + 501 + i * 2,
                },
                `turn_complete ${tag}#${i}`,
                { tolerant: true },
              );
              await hold(periodMs / 2);
              i++;
            }
          };
        };

        // Cell 11 — turn cycling with room to settle: 260ms settle + grace
        // completes inside the 500ms gap. The clean boundary crossing.
        await runCell("turn-cycle", turnCycle("C", "cyc", 1000));

        // Cell 12 — turn cycling under the settle: the next send promotes
        // the status dot while its settle transition is mid-flight.
        await runCell("turn-cycle-fast", turnCycle("C", "cycF", 300));

        console.log(`[at9996] REPORT ${JSON.stringify(report)}`);
        // caret-* cells live in the foreground test below, so a filtered run
        // naming them contributes nothing to this matrix.
        expect(Object.keys(report).length).toBe(
          ONLY_CELLS.length > 0
            ? ONLY_CELLS.filter((c) => !c.startsWith("caret-")).length
            : 18,
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // The caret cells run FOREGROUND: the blink is gated on `.cm-focused`,
  // which CM6 derives from real DOM focus, and a background app-test
  // window's document never has focus — `content.focus()` sets
  // activeElement but `document.hasFocus()` stays false, `.cm-focused`
  // never applies, and there is no animation to count. Gated behind
  // AT9996_CARET=1 so a plain lab run never steals the screen.
  test.skipIf(process.env.AT9996_CARET !== "1")(
    "caret cells (foreground): idle / typing / focus-flip / select-cycle",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at9996-anim-island-caret",
        env: { TUGBANK_PATH: tugbankPath },
        foreground: true,
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

        // The composer's CM6 editor mounts with the session binding — an
        // unbound session card carries no .cm-editor to drive.
        await app.bindSession("A", { tugSessionId: "at9996-caret-A" });
        await app.awaitEngineReady("A", { timeoutMs: 20_000 });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(".cm-editor .tug-text-editor-caret-layer").length >= 1`,
          { timeoutMs: 10_000 },
        );

        const report: Record<string, unknown> = {};
        const hold = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));

        /** In-page caret driver: an async gesture script against the first
         *  prompt editor carrying a caret layer. Keystrokes are a keydown
         *  dispatch (engages the typing attribute) plus execCommand — real
         *  contenteditable input CM6 ingests as a doc change. Completion is
         *  signalled through window.__at9996CaretDone, polled from outside;
         *  the driver itself returns immediately (no long-held RPC). */
        const caretDrive = (body: string): string => `(function () {
  var eds = Array.prototype.filter.call(
    document.querySelectorAll(".cm-editor"),
    function (e) { return e.querySelector(".tug-text-editor-caret-layer"); });
  var ed = eds[0];
  if (!ed) { window.__at9996CaretDone = "no-editor"; return "no-editor"; }
  var content = ed.querySelector(".cm-content");
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var key = function (k) { content.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); };
  var type = function (ch) { key(ch); document.execCommand("insertText", false, ch); };
  var del = function () { key("Backspace"); document.execCommand("delete", false); };
  window.__at9996CaretDone = "";
  (async function () {
    ${body}
    window.__at9996CaretDone = "done";
  })();
  return "started";
})()`;

        const CARET_STATE = `(function () {
  var layers = document.querySelectorAll(".tug-text-editor-caret-layer");
  return {
    done: window.__at9996CaretDone,
    editors: document.querySelectorAll(".cm-editor").length,
    layers: layers.length,
    focusedEditor: !!document.querySelector(".cm-editor.cm-focused"),
    docHasFocus: document.hasFocus(),
    activeEl: document.activeElement ? document.activeElement.className.split(" ")[0] : null,
    blinkAnims: document.getAnimations().filter(function (a) {
      return a.animationName === "tug-text-editor-caret-blink";
    }).length,
  };
})()`;

        const caretCell = async (name: string, body: string): Promise<void> => {
          if (ONLY_CELLS.length > 0 && !ONLY_CELLS.includes(name)) return;
          await withDeadline(app.evalJS<boolean>(ARM_METER), `arm ${name}`);
          const t0 = Date.now();
          await withDeadline(
            app.evalJS<string>(caretDrive(body)),
            `caret drive ${name}`,
          );
          await app.waitForCondition<boolean>(
            `window.__at9996CaretDone !== ""`,
            { timeoutMs: CELL_SECS * 1000 + 20_000 },
          );
          const left = CELL_SECS * 1000 - (Date.now() - t0);
          if (left > 0) await hold(left);
          const meter = await withDeadline(
            app.evalJS<Record<string, unknown>>(READ_METER),
            `read ${name}`,
          );
          const state = await withDeadline(
            app.evalJS<Record<string, unknown>>(CARET_STATE),
            `caret state ${name}`,
          );
          report[name] = { meter, state, t0, t1: Date.now() };
          console.log(`[at9996] CARET-CELL ${name} → ${JSON.stringify({ meter, state })}`);
          expect(state.done).toBe("done");
        };

        // Focused editor, hands off: the blink must start once (the focus)
        // and never restart on its own.
        await caretCell("caret-idle", `content.focus(); await sleep(300);`);

        // Two keystroke bursts with idle-expiry gaps (the typing attribute
        // clears 500ms after the last keydown). The suppression toggles
        // animation-name; the question is one pair per burst or one per
        // keystroke.
        await caretCell(
          "caret-typing",
          `content.focus(); await sleep(400);
    for (var i = 0; i < 15; i++) { type("x"); await sleep(80); }
    await sleep(900);
    for (var j = 0; j < 15; j++) { del(); await sleep(80); }
    await sleep(900);`,
        );

        // Blur/focus cycles: the .cm-focused gate. One pair per flip is the
        // contract; more is amplification.
        await caretCell(
          "caret-focus-flip",
          `content.focus(); await sleep(300);
    for (var i = 0; i < 6; i++) {
      content.blur(); await sleep(200);
      content.focus(); await sleep(200);
    }`,
        );

        // Select-all↔collapse cycles: a non-collapsed selection empties the
        // caret layer's marker set, and CM6's LayerView answers an emptied
        // set with display:none on WebKit — cancelling the blink on the
        // layer element itself. Collapse restores it: a fresh start.
        await caretCell(
          "caret-select-cycle",
          `content.focus(); await sleep(300);
    for (var i = 0; i < 8; i++) { type("s"); }
    await sleep(700);
    var sel = window.getSelection();
    for (var c = 0; c < 5; c++) {
      sel.selectAllChildren(content); await sleep(250);
      sel.collapseToEnd(); await sleep(250);
    }
    await sleep(700);
    for (var d = 0; d < 8; d++) { del(); await sleep(60); }
    await sleep(600);`,
        );

        console.log(`[at9996] CARET-REPORT ${JSON.stringify(report)}`);
        expect(Object.keys(report).length).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // Idle watch for the 30s wake-stall train (live-deck finding, 2026-08-01):
  // the release deck's WebContent stops receiving main-thread wakeups — rAF
  // AND an armed 8ms setTimeout chain together — for a ~330ms pair every
  // 30.000s, phase-locked to process launch, unmasked by CPU load, with every
  // thread in every process of the WebKit family parked. This cell asks
  // whether a fresh instance with a light deck grows its own train (platform
  // behavior) or stays clean (release-instance state). The 8ms timer chain is
  // the primary signal. Foreground is mandatory: a background window
  // throttles DOM timers toward 1s alignment, which starves the chain and
  // floods the gap ledger — the same class of artifact as the caret tier's
  // focus gate.
  test.skipIf(process.env.AT9996_STALL !== "1")(
    "stall probe: does a fresh idle instance grow the 30s wake-stall train?",
    async () => {
      // Soak mode: age the instance in the background before the watch —
      // the release train's remaining differentiators include process age.
      // Launch stays background during the soak (no 30-minute screen
      // seizure); a nativeClick activates the app just before arming, which
      // simultaneously satisfies WebKit's interaction heuristic (a
      // never-interacted page gets its DOM timers 1s-aligned within ~40s
      // even in the foreground).
      const SOAK_SECS = Number(process.env.AT9996_STALL_SOAK_SECS ?? "0");
      // Real-session knob: spawn genuine tugcode `--resume` processes (live
      // WS feeds) into every card instead of / alongside synthetic binds —
      // the S9 differentiator the synthetic path can never cover.
      const STALL_REAL = process.env.AT9996_STALL_REAL === "1";
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      let cleanupReal: (() => void) | null = null;
      const app = await launchTugApp({
        testName: "at9996-anim-island-stall",
        env: { TUGBANK_PATH: tugbankPath },
        foreground: SOAK_SECS === 0,
      });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });

        // Weight knob: blocks per session of settled transcript before the
        // watch, so the light-vs-heavy comparison runs in the same cell.
        const STALL_WEIGHT = Number(process.env.AT9996_STALL_WEIGHT ?? "0");
        if (STALL_REAL) {
          cleanupReal = await seedRealResumeSessions(app);
          // Seed one real interaction so the never-interacted foreground
          // page can't 1s-align its DOM timers mid-watch (artifact #4).
          await app.nativeClick({ x: 440, y: 45 }, { activateFirst: true });
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        } else if (STALL_WEIGHT > 0) {
          await seedTranscriptWeight(app, STALL_WEIGHT, "at9996-stall");
        }

        if (SOAK_SECS > 0) {
          await new Promise((resolve) => setTimeout(resolve, SOAK_SECS * 1_000));
          await app.nativeClick({ x: 440, y: 45 }, { activateFirst: true });
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }

        const armed = await app.evalJS<string>(`(function () {
  if (window.__at9996Stall) return "already-armed";
  var S = { t0: performance.now(), epoch: Date.now() - performance.now(),
            raf: [], tmr: [], rafTicks: 0, tmrTicks: 0, stopped: false };
  window.__at9996Stall = S;
  var lastRaf = performance.now();
  function loop(ts) {
    if (S.stopped) return;
    var gap = ts - lastRaf;
    if (gap > 50) S.raf.push({ gap: Math.round(gap), wall: Math.round(S.epoch + ts) });
    lastRaf = ts; S.rafTicks++;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  var lastTmr = performance.now();
  function tick() {
    if (S.stopped) return;
    var now = performance.now();
    var gap = now - lastTmr;
    if (gap > 50) S.tmr.push({ gap: Math.round(gap), wall: Math.round(S.epoch + now) });
    lastTmr = now; S.tmrTicks++;
    setTimeout(tick, 8);
  }
  setTimeout(tick, 8);
  return "armed";
})()`);
        expect(armed).toBe("armed");

        const WATCH_MS = Number(process.env.AT9996_STALL_SECS ?? "95") * 1_000;
        await new Promise((resolve) => setTimeout(resolve, WATCH_MS));

        const out = await app.evalJS<{
          tmrTicks: number;
          rafTicks: number;
          tmr: Array<{ gap: number; wall: number }>;
          raf: Array<{ gap: number; wall: number }>;
          vis: string;
          focus: boolean;
        }>(`(function () {
  var S = window.__at9996Stall;
  S.stopped = true;
  return { tmrTicks: S.tmrTicks, rafTicks: S.rafTicks,
           tmr: S.tmr.slice(0, 200), raf: S.raf.slice(0, 200),
           nodes: document.querySelectorAll("*").length,
           vis: document.visibilityState, focus: document.hasFocus() };
})()`);
        console.log(`[at9996] STALL-REPORT ${JSON.stringify(out)}`);
        // The instrument must have been alive the whole watch — a wedged
        // timer chain would fake a clean report.
        expect(out.tmrTicks).toBeGreaterThan((WATCH_MS / 10) * 0.5);
      } finally {
        await app.close();
        if (cleanupReal !== null) cleanupReal();
      }
    },
    TEST_TIMEOUT_MS +
      (Number(process.env.AT9996_STALL_SOAK_SECS ?? "0") +
        Number(process.env.AT9996_STALL_SECS ?? "95")) *
        1_000,
  );

  // Synthetic typist: replays a human burst/pause cadence into the focused
  // composer with REAL key events — the harness's postToPid path posts
  // CGEvents that traverse the actual input pipeline, so keydown queue delay
  // q (handler entry minus event.timeStamp) measures the same latency the
  // user feels. An in-page dispatchEvent stamps timeStamp at dispatch and
  // can never measure q. Cadence parameterized from the 2026-08-01 live
  // ledger runs: bursts of 6–12 keys at 140–220ms inter-key, 0.6–3s pauses
  // between bursts, an occasional 5–8s think pause (~3.7 keys/s sustained).
  // Deterministic via an LCG so a regression run replays the same tape.
  // Foreground mandatory: real keys land at the key window, and the caret
  // path needs real document focus.
  test.skipIf(process.env.AT9996_TYPIST !== "1")(
    "synthetic typist: keystroke q percentiles under a human cadence",
    async () => {
      const WEIGHT = Number(process.env.AT9996_TYPIST_WEIGHT ?? "0");
      const KEYS_TARGET = Number(process.env.AT9996_TYPIST_KEYS ?? "300");
      const SEED = Number(process.env.AT9996_TYPIST_SEED ?? "1");
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at9996-anim-island-typist",
        env: { TUGBANK_PATH: tugbankPath },
        foreground: true,
      });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        if (WEIGHT > 0) {
          await seedTranscriptWeight(app, WEIGHT, "at9996-typist");
        } else {
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 8_000 },
          );
          await app.bindSession("A", { tugSessionId: "at9996-typist-A" });
          await app.awaitEngineReady("A", { timeoutMs: 20_000 });
        }
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(".cm-editor .cm-content").length >= 1`,
          { timeoutMs: 10_000 },
        );

        // Land the keyboard in the composer with a real activation click.
        await app.nativeClickAtElement(".cm-editor .cm-content");
        await app.waitForCondition<boolean>(
          `!!document.querySelector(".cm-editor.cm-focused")`,
          { timeoutMs: 8_000 },
        );

        const armed = await app.evalJS<string>(`(function () {
  if (window.__at9996Typist) return "already-armed";
  var S = { t0: performance.now(), keys: [], longs: [], stopped: false };
  window.__at9996Typist = S;
  S.onKey = function (e) {
    var now = performance.now();
    S.keys.push({
      ms: Math.round(now - S.t0),
      q: Math.round(now - e.timeStamp),
      rep: e.repeat === true,
      tr: e.isTrusted === true,
    });
  };
  window.addEventListener("keydown", S.onKey, { capture: true, passive: true });
  var last = performance.now();
  function loop(ts) {
    if (S.stopped) return;
    var gap = ts - last;
    if (gap > 50) S.longs.push({ ms: Math.round(ts - S.t0), gap: Math.round(gap) });
    last = ts;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  return "armed";
})()`);
        expect(armed).toBe("armed");

        // Deterministic cadence tape.
        let lcg = SEED >>> 0;
        const rand = (): number => {
          lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
          return lcg / 4294967296;
        };
        const between = (lo: number, hi: number): number =>
          lo + rand() * (hi - lo);
        const POOL = "the quick brown fox jumps over the lazy dog and then some more words for the tape ";
        const hold = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));

        let sent = 0;
        let poolIx = 0;
        while (sent < KEYS_TARGET) {
          const burst = Math.round(between(6, 12));
          for (let k = 0; k < burst && sent < KEYS_TARGET; k++) {
            const ch = POOL[poolIx % POOL.length];
            poolIx++;
            await app.nativeType(ch);
            sent++;
            await hold(between(140, 220));
          }
          await hold(rand() < 0.12 ? between(5_000, 8_000) : between(600, 3_000));
        }

        const out = await app.evalJS<{
          keys: Array<{ ms: number; q: number; rep: boolean; tr: boolean }>;
          longs: Array<{ ms: number; gap: number }>;
        }>(`(function () {
  var S = window.__at9996Typist;
  S.stopped = true;
  window.removeEventListener("keydown", S.onKey, { capture: true });
  return { keys: S.keys, longs: S.longs };
})()`);

        // Percentiles over trusted, non-autorepeat events only. Under load
        // the poster's key-up can land late enough for macOS autorepeat to
        // fire (`repeat: true` keydowns beyond the cadence tape), and any
        // in-page re-dispatch would arrive untrusted with a fresh
        // timeStamp (q ≈ 0) — both contaminate the distribution.
        const clean = out.keys.filter((k) => k.tr && !k.rep);
        const qs = clean.map((k) => k.q).sort((a, b) => a - b);
        const pct = (p: number): number =>
          qs.length === 0 ? -1 : qs[Math.min(qs.length - 1, Math.floor((p / 100) * qs.length))];
        const report = {
          sent,
          recorded: out.keys.length,
          clean: qs.length,
          repeats: out.keys.filter((k) => k.rep).length,
          untrusted: out.keys.filter((k) => !k.tr).length,
          q50: pct(50),
          q90: pct(90),
          q99: pct(99),
          qMax: qs[qs.length - 1] ?? -1,
          over25: qs.filter((q) => q > 25).length,
          longs: out.longs.filter((l) => l.gap > 100),
        };
        console.log(`[at9996] TYPIST-REPORT ${JSON.stringify(report)}`);
        // Real keys must actually have traversed the pipeline into the page.
        expect(qs.length).toBeGreaterThan(sent * 0.9);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // Transcript DOM eviction (`evictOffscreen`). Seeds one session with a long
  // run of separate rows, then reads three things the mode must be true about:
  //
  //   1. how few rows stay mounted once eviction arms — the footprint claim
  //   2. that a full-range scroll doesn't move the scroll height — the
  //      pixel-identity claim, since spacers stand at measured heights
  //   3. that the suspension counter stays put — proof no commit had to fall
  //      back to rendering everything, i.e. the ledger really covers the rows
  //
  // The mounted/total node ratio is captured as a same-instance A/B: the
  // pre-arm high-water mark IS the inline population (every row mounted),
  // because that is exactly what the transcript renders before it has measured
  // enough to evict. No build flag, no second run.
  //
  // Opt-in (AT9996_EVICT=1) so a plain lab run doesn't pay the seed.
  test.skipIf(process.env.AT9996_EVICT !== "1")(
    "eviction: mounted-cell budget, scroll continuity, no suspensions",
    async () => {
      const TURNS = Number(process.env.AT9996_EVICT_TURNS ?? "150");
      const ROWS = TURNS * 2;
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at9996-evict",
        env: { TUGBANK_PATH: tugbankPath },
        foreground: true,
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

        // Sample the mounted population while the rows arrive. The maximum
        // seen with `data-evict-active` ABSENT is the inline baseline.
        // Nodes-per-row, sampled from the widest mounted population seen
        // while the transcript was still short enough that the window held
        // every row. That is a genuinely inline reading — the same rows, the
        // same renderers, nothing evicted — and it is what makes the final
        // node count comparable to anything.
        let peakNodes = 0;
        let peakCells = 0;
        const sample = async (): Promise<void> => {
          const s = await app.evalJS<{
            active: boolean;
            cells: number;
            nodes: number;
          } | null>(`(function () {
  var el = document.querySelector('[data-tug-scroll-key="session-card-transcript"]');
  if (!el) return null;
  return {
    active: el.hasAttribute("data-evict-active"),
    cells: el.querySelectorAll("[data-tug-list-cell-index]").length,
    nodes: el.getElementsByTagName("*").length,
  };
})()`);
          if (s === null || s.cells <= peakCells) return;
          peakCells = s.cells;
          peakNodes = s.nodes;
        };

        await seedTranscriptTurns(app, "A", TURNS, "at9996-evict", sample);

        // Eviction arms on the settled edge.
        await app.waitForCondition<boolean>(
          `!!document.querySelector('[data-tug-scroll-key="session-card-transcript"][data-evict-active]')`,
          { timeoutMs: 30_000 },
        );

        const before = await app.evalJS<{
          cells: number;
          nodes: number;
          rows: number;
          budget: number;
          minRow: number;
          viewport: number;
          scrollHeight: number;
          fallbacks: number;
          spacers: string;
        }>(`(function () {
  var el = document.querySelector('[data-tug-scroll-key="session-card-transcript"]');
  var cells = Array.prototype.slice.call(el.querySelectorAll("[data-tug-list-cell-index]"));
  var minRow = Infinity;
  var maxIx = -1;
  cells.forEach(function (c) {
    var h = c.getBoundingClientRect().height;
    if (h > 0 && h < minRow) minRow = h;
    var ix = Number(c.getAttribute("data-tug-list-cell-index"));
    if (ix > maxIx) maxIx = ix;
  });
  if (!isFinite(minRow) || minRow < 1) minRow = 1;
  var vh = el.clientHeight;
  // The window spans the viewport plus the retain margin on each side (two
  // viewports), so the cell count it can hold is that span over the
  // shortest row, plus the overscan cells and a little slack for a pin.
  var budget = Math.ceil((vh + 4 * vh) / minRow) + 6 + 4;
  var top = el.querySelector(".tug-list-view-spacer--top");
  var bot = el.querySelector(".tug-list-view-spacer--bottom");
  return {
    cells: cells.length,
    nodes: el.getElementsByTagName("*").length,
    rows: maxIx + 1,
    budget: budget,
    minRow: Math.round(minRow),
    viewport: vh,
    scrollHeight: el.scrollHeight,
    fallbacks: Number(el.getAttribute("data-evict-fallbacks") || "-1"),
    spacers: (top ? top.style.height : "?") + "/" + (bot ? bot.style.height : "?"),
  };
})()`);

        // Scripted full-range scroll: top, then bottom, then back. Each stop
        // re-windows, mounts, measures, and evicts — the scroll height must
        // not move, because every spacer stands at a measured height.
        const traverse = async (): Promise<number[]> => {
          const seen: number[] = [];
          for (const frac of [0, 0.25, 0.5, 0.75, 1, 0.5, 0]) {
            seen.push(
              await app.evalJS<number>(`(function () {
  var el = document.querySelector('[data-tug-scroll-key="session-card-transcript"]');
  el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * ${frac});
  return el.scrollHeight;
})()`),
            );
            await new Promise((r) => setTimeout(r, 400));
          }
          return seen;
        };
        // Two passes. The first one warms: every row is re-mounted for the
        // first time since it was measured, and any row whose height moved in
        // the interval corrects then. The SECOND pass is the pixel-identity
        // claim — by then nothing may move at all.
        const pass1 = [before.scrollHeight, ...(await traverse())];
        const pass2 = await traverse();
        const spread = (xs: number[]): number =>
          Math.max(...xs) - Math.min(...xs);
        const heights = [...pass1, ...pass2];

        const after = await app.evalJS<{
          cells: number;
          nodes: number;
          scrollHeight: number;
          fallbacks: number;
          active: boolean;
        }>(`(function () {
  var el = document.querySelector('[data-tug-scroll-key="session-card-transcript"]');
  return {
    cells: el.querySelectorAll("[data-tug-list-cell-index]").length,
    nodes: el.getElementsByTagName("*").length,
    scrollHeight: el.scrollHeight,
    fallbacks: Number(el.getAttribute("data-evict-fallbacks") || "-1"),
    active: el.hasAttribute("data-evict-active"),
  };
})()`);
        heights.push(after.scrollHeight);

        const warmDrift = spread(pass1);
        const steadyDrift = spread(pass2);
        const report = {
          rows: before.rows,
          seeded: ROWS,
          mountedCells: before.cells,
          budget: before.budget,
          minRow: before.minRow,
          viewport: before.viewport,
          mountedNodes: before.nodes,
          sampledCells: peakCells,
          sampledNodes: peakNodes,
          // What this content would mount inline, extrapolated from the
          // sampled nodes-per-row. An estimate, and labelled one.
          projectedInlineNodes:
            peakCells > 0
              ? Math.round((peakNodes / peakCells) * before.rows)
              : -1,
          nodeReductionPct:
            peakCells > 0
              ? Math.round(
                  (1 - before.nodes / ((peakNodes / peakCells) * before.rows)) *
                    100,
                )
              : -1,
          scrollHeight: before.scrollHeight,
          warmPassDriftPx: warmDrift,
          steadyPassDriftPx: steadyDrift,
          heights,
          fallbacksBefore: before.fallbacks,
          fallbacksAfter: after.fallbacks,
          activeAfterScroll: after.active,
        };
        console.log(`[at9996] EVICT-REPORT ${JSON.stringify(report)}`);

        // The list really is long, and really is mostly unmounted.
        expect(before.rows).toBeGreaterThan(ROWS * 0.8);
        expect(before.cells).toBeLessThanOrEqual(before.budget);
        expect(before.cells).toBeLessThan(before.rows / 2);
        expect(report.nodeReductionPct).toBeGreaterThanOrEqual(60);
        // Pixel identity, to the tolerance the measurement itself has. Each
        // evicted row is represented by its remembered height, and a row
        // measured while mounted can disagree with that by a fraction of a
        // pixel; across hundreds of rows those fractions sum to a residual
        // that shifts as the window moves. Two thousandths of the document
        // is far below the scrollbar's own resolution — but it is a ceiling,
        // and a regression that dropped a row's height (a lost gap, a
        // mis-keyed ledger entry) would blow straight through it.
        expect(steadyDrift).toBeLessThan(before.scrollHeight * 0.002);
        expect(warmDrift).toBeLessThan(before.scrollHeight * 0.002);
        // No commit fell back to rendering everything while scrolling.
        expect(after.fallbacks).toBe(before.fallbacks);
        expect(after.active).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // -----------------------------------------------------------------------
  // Tile ledger (roadmap/scrolling-memory-diet.md §G2). Attributes graphics
  // backing store — vmmap's single "owned unmapped memory" region, the
  // IOSurface pool — to the transcript scroller, per condition:
  //
  //   baseline      deck up, transcript empty — the chrome floor
  //   rest          parked mid-document, nothing moving
  //   purge         forced purges (notifyutil org.WebKit.lowMemory), the
  //                 trough and the re-materialization slope
  //   scroll        scripted constant-velocity full-range sweep
  //
  // each run twice: eviction ON (the shipped default) and OFF (the full
  // inline DOM at identical layer height, via the 1.18.0 lab flag). The
  // sampler shells `vmmap --summary` from THIS process — host-side reads
  // never touch the one-at-a-time harness RPC channel, so they can overlap
  // scroll driving. Foreground launch: a background window's tiles are
  // purged wholesale, which would measure occlusion policy, not coverage.
  //
  // An instrument, not a regression gate — the numbers land in the brief.
  test.skipIf(process.env.AT9996_TILES !== "1")(
    "tile ledger: graphics dirty by phase, eviction A/B",
    async () => {
      const TURNS = Number(process.env.AT9996_TILES_TURNS ?? "150");
      const ROWS = TURNS * 2;
      const REST_SECS = Number(process.env.AT9996_TILES_REST_SECS ?? "45");
      const PURGE_CYCLES = 3;

      const sleep = (ms: number): Promise<void> =>
        new Promise((r) => setTimeout(r, ms));

      const priorWebContent = listWebContentPids();
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at9996-tiles",
        env: { TUGBANK_PATH: tugbankPath },
        foreground: true,
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

        // The instance's WebContent: the pid that appeared since the
        // pre-launch snapshot. WebContent is launchd-parented, so parentage
        // can't identify it; arrival can. If several arrived, the heaviest
        // malloc belongs to the deck.
        let wcPid = -1;
        for (let i = 0; i < 40 && wcPid < 0; i += 1) {
          const fresh = [...listWebContentPids()].filter(
            (p) => !priorWebContent.has(p),
          );
          if (fresh.length === 1) {
            wcPid = fresh[0]!;
          } else if (fresh.length > 1) {
            let best = -1;
            let bestMalloc = -1;
            for (const p of fresh) {
              const led = readTileLedger(p);
              if (led !== null && led.mallocMB > bestMalloc) {
                bestMalloc = led.mallocMB;
                best = p;
              }
            }
            wcPid = best;
          }
          if (wcPid < 0) await sleep(250);
        }
        expect(wcPid).toBeGreaterThan(0);

        const t0 = Date.now();
        const samples: Array<{
          phase: string;
          t: number;
          gfxMB: number;
          mallocMB: number;
        }> = [];
        const sample = (phase: string): void => {
          const led = readTileLedger(wcPid);
          if (led === null) return;
          samples.push({
            phase,
            t: Math.round((Date.now() - t0) / 100) / 10,
            ...led,
          });
        };
        const sampleFor = async (
          phase: string,
          secs: number,
          everyMs = 5_000,
        ): Promise<void> => {
          const end = Date.now() + secs * 1000;
          for (;;) {
            sample(phase);
            if (Date.now() + everyMs > end) return;
            await sleep(everyMs);
          }
        };

        const scroller = `document.querySelector('[data-tug-scroll-key="session-card-transcript"]')`;
        const geometry = (): Promise<{
          vw: number;
          vh: number;
          scrollHeight: number;
          cells: number;
          nodes: number;
          active: boolean;
          fallbacks: number;
          dpr: number;
          focused: boolean;
          visibility: string;
        }> =>
          app.evalJS(`(function () {
  var el = ${scroller};
  return {
    vw: el.clientWidth,
    vh: el.clientHeight,
    scrollHeight: el.scrollHeight,
    cells: el.querySelectorAll("[data-tug-list-cell-index]").length,
    nodes: el.getElementsByTagName("*").length,
    active: el.hasAttribute("data-evict-active"),
    fallbacks: Number(el.getAttribute("data-evict-fallbacks") || "-1"),
    dpr: window.devicePixelRatio,
    focused: document.hasFocus(),
    visibility: document.visibilityState,
  };
})()`);
        const parkAt = (frac: number): Promise<number> =>
          app.evalJS<number>(`(function () {
  var el = ${scroller};
  el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * ${frac});
  return el.scrollTop;
})()`);

        // Constant-velocity sweep: half-viewport steps at 4/s, top→bottom→
        // top. Ledger reads overlap the drive as async vmmap spawns.
        const scrollSweep = async (phase: string): Promise<void> => {
          const pendingReads: Array<Promise<void>> = [];
          const readAsync = (): void => {
            const at = Math.round((Date.now() - t0) / 100) / 10;
            pendingReads.push(
              readTileLedgerAsync(wcPid).then((led) => {
                if (led !== null) samples.push({ phase, t: at, ...led });
              }),
            );
          };
          const sh = await app.evalJS<number>(
            `${scroller}.scrollHeight - ${scroller}.clientHeight`,
          );
          const vh = await app.evalJS<number>(`${scroller}.clientHeight`);
          const step = Math.max(1, Math.round(vh / 2));
          const tops: number[] = [];
          for (let y = 0; y <= sh; y += step) tops.push(y);
          for (let y = sh; y >= 0; y -= step) tops.push(y);
          for (let i = 0; i < tops.length; i += 1) {
            await app.evalJS<number>(
              `(function () { var el = ${scroller}; el.scrollTop = ${tops[i]}; return el.scrollTop; })()`,
            );
            if (i % 8 === 0) readAsync();
            await sleep(250);
          }
          await Promise.all(pendingReads);
        };

        const purgeCycles = async (phase: string): Promise<void> => {
          for (let c = 0; c < PURGE_CYCLES; c += 1) {
            // Darwin-global: every WebContent on the machine purges too —
            // each just repaints once, as it already does on the 30s clock.
            Bun.spawnSync(["notifyutil", "-p", "org.WebKit.lowMemory"]);
            await sampleFor(phase, 8, 1_000);
            await sampleFor(phase, 22, 5_000);
          }
        };

        const runCondition = async (tag: string): Promise<void> => {
          await parkAt(0.5);
          await sleep(2_000);
          await sampleFor(`rest-${tag}`, REST_SECS);
          await purgeCycles(`purge-${tag}`);
          await scrollSweep(`scroll-${tag}`);
        };

        // Chrome floor before any transcript exists.
        await sampleFor("baseline", 15);

        await seedTranscriptTurns(app, "A", TURNS, "at9996-tiles");
        await app.waitForCondition<boolean>(
          `!!document.querySelector('[data-tug-scroll-key="session-card-transcript"][data-evict-active]')`,
          { timeoutMs: 30_000 },
        );
        // Visible-window precondition. Tile coverage is a property of a
        // VISIBLE page — a hidden window's backing is dropped or minimized
        // by policy, so every number sampled against one measures occlusion
        // policy, not coverage (the 2026-08-01 runs failed exactly this
        // way: the user was at the machine and the lab window was buried).
        // Fail fast with the reason instead of producing plausible junk.
        {
          const vis = await app.evalJS<string>(`document.visibilityState`);
          if (vis !== "visible") {
            throw new Error(
              `tile ledger requires a visible lab window (visibilityState=${vis}); run when the machine is free`,
            );
          }
        }
        // Warm sweep, unsampled, in half-viewport steps so EVERY row
        // remounts: rows measured while the window was backgrounded
        // mid-seed carry short heights (cv-skipped layout), and a
        // fractional-stop traversal leaves the rows between stops
        // uncorrected. After this both arms run on the true layer height.
        {
          const sh = await app.evalJS<number>(
            `${scroller}.scrollHeight - ${scroller}.clientHeight`,
          );
          const vh = await app.evalJS<number>(`${scroller}.clientHeight`);
          const step = Math.max(1, Math.round(vh / 2));
          for (let y = 0; y <= sh; y += step) {
            await app.evalJS<number>(
              `(function () { var el = ${scroller}; el.scrollTop = ${y}; return el.scrollTop; })()`,
            );
            await sleep(150);
          }
        }
        const geomEvict = await geometry();
        await runCondition("evict");

        // The A/B arm: same rows, same layer height, full inline DOM.
        await app.evalJS<void>(
          `window.__tug.setTranscriptEvictionDisabled(true)`,
        );
        await app.waitForCondition<boolean>(
          `!document.querySelector('[data-tug-scroll-key="session-card-transcript"][data-evict-active]')`,
          { timeoutMs: 30_000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('[data-tug-scroll-key="session-card-transcript"] [data-tug-list-cell-index]').length >= ${ROWS}`,
          { timeoutMs: 60_000 },
        );
        await sleep(3_000);
        const geomFull = await geometry();
        await runCondition("full");

        // Flip back and confirm eviction re-arms on the intact ledger.
        await app.evalJS<void>(
          `window.__tug.setTranscriptEvictionDisabled(false)`,
        );
        await app.waitForCondition<boolean>(
          `!!document.querySelector('[data-tug-scroll-key="session-card-transcript"][data-evict-active]')`,
          { timeoutMs: 30_000 },
        );
        const geomRearm = await geometry();

        const byPhase: Record<
          string,
          { n: number; minMB: number; maxMB: number; meanMB: number }
        > = {};
        for (const s of samples) {
          const agg = (byPhase[s.phase] ??= {
            n: 0,
            minMB: Infinity,
            maxMB: -Infinity,
            meanMB: 0,
          });
          agg.n += 1;
          agg.minMB = Math.min(agg.minMB, s.gfxMB);
          agg.maxMB = Math.max(agg.maxMB, s.gfxMB);
          agg.meanMB += s.gfxMB;
        }
        for (const agg of Object.values(byPhase)) {
          agg.meanMB = Math.round(agg.meanMB / agg.n);
          agg.minMB = Math.round(agg.minMB);
          agg.maxMB = Math.round(agg.maxMB);
        }
        const report = {
          wcPid,
          turns: TURNS,
          geomEvict,
          geomFull,
          geomRearm,
          byPhase,
        };
        console.log(`[at9996] TILE-LEDGER ${JSON.stringify(report)}`);
        writeFileSync(
          "/tmp/at9996-tiles.json",
          JSON.stringify({ report, samples }, null, 2),
        );

        // Instrument sanity, not a memory gate: both arms really ran on the
        // shape they claim, and every phase produced readings.
        expect(geomEvict.active).toBe(true);
        expect(geomEvict.cells).toBeLessThan(ROWS / 2);
        expect(geomFull.active).toBe(false);
        expect(geomFull.cells).toBeGreaterThanOrEqual(ROWS);
        // Both arms measured the same document at the same layer height —
        // the instrument-validity check the backgrounded-window artifact
        // fails (short seed-time measures leave the evicted layer a
        // fraction of the true height, and the arms stop being comparable).
        expect(geomFull.scrollHeight).toBeGreaterThan(
          geomEvict.scrollHeight * 0.95,
        );
        expect(geomFull.scrollHeight).toBeLessThan(
          geomEvict.scrollHeight * 1.05,
        );
        expect(geomRearm.active).toBe(true);
        for (const phase of [
          "baseline",
          "rest-evict",
          "purge-evict",
          "scroll-evict",
          "rest-full",
          "purge-full",
          "scroll-full",
        ]) {
          expect(byPhase[phase]?.n ?? 0).toBeGreaterThan(0);
        }
      } finally {
        await app.close();
      }
    },
    1_500_000,
  );

  // -----------------------------------------------------------------------
  // Editor tile ledger (roadmap/scrolling-memory-diet.md §G6, answers G2's
  // Q3): what does ONE VISIBLE heavy CM6 editor cost in graphics backing?
  // A Text card bound to a real ~5k-line source file (CM6 windows its DOM
  // but declares the full content-height scroll layer), measured probe-A
  // style: rest + purge floors with the editor visible, then the same deck
  // with the editor's pane `visibility: hidden`, then revealed again. The
  // causal delta between the visible and hidden floors is the editor's
  // share. Foreground launch for the same reason as the tile ledger — a
  // hidden window measures occlusion policy, not coverage.
  test.skipIf(process.env.AT9996_EDITOR_TILES !== "1")(
    "editor tile ledger: visible heavy CM6 editor share",
    async () => {
      const REST_SECS = Number(process.env.AT9996_TILES_REST_SECS ?? "45");
      const PURGE_CYCLES = 3;
      const heavyPath = new URL(
        "../../tugdeck/src/components/tugways/tug-list-view.tsx",
        import.meta.url,
      ).pathname;

      const sleep = (ms: number): Promise<void> =>
        new Promise((r) => setTimeout(r, ms));

      const priorWebContent = listWebContentPids();
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at9996-editor-tiles",
        env: { TUGBANK_PATH: tugbankPath },
        foreground: true,
      });
      try {
        await app.seedDeckState({
          state: {
            cards: [
              { id: "T", componentId: "text", title: "", closable: true },
            ],
            panes: [
              {
                id: "pT",
                position: { x: 40, y: 40 },
                size: { width: 800, height: 1100 },
                cardIds: ["T"],
                activeCardId: "T",
                title: "",
                acceptsFamilies: ["standard"],
                slot: 0,
              },
            ],
            activePaneId: "pT",
            imposition: { kind: "five-up", lens: "right" },
            hasFocus: true,
          },
          cardStates: {
            T: {
              content: {
                path: heavyPath,
                draftId: null,
                untitled: false,
                untitledNumber: null,
                anchor: { line: 1, ch: 0 },
                scrollTop: 0,
              },
            },
          },
          focusCardId: "T",
        });

        const scroller = `document.querySelector(".cm-editor .cm-scroller")`;
        await app.waitForCondition<boolean>(
          `!!${scroller} && ${scroller}.scrollHeight > 10000`,
          { timeoutMs: 30_000 },
        );
        {
          const vis = await app.evalJS<string>(`document.visibilityState`);
          if (vis !== "visible") {
            throw new Error(
              `editor tile ledger requires a visible lab window (visibilityState=${vis}); run when the machine is free`,
            );
          }
        }

        let wcPid = -1;
        for (let i = 0; i < 40 && wcPid < 0; i += 1) {
          const fresh = [...listWebContentPids()].filter(
            (p) => !priorWebContent.has(p),
          );
          if (fresh.length === 1) {
            wcPid = fresh[0]!;
          } else if (fresh.length > 1) {
            let best = -1;
            let bestMalloc = -1;
            for (const p of fresh) {
              const led = readTileLedger(p);
              if (led !== null && led.mallocMB > bestMalloc) {
                bestMalloc = led.mallocMB;
                best = p;
              }
            }
            wcPid = best;
          }
          if (wcPid < 0) await sleep(250);
        }
        expect(wcPid).toBeGreaterThan(0);

        const t0 = Date.now();
        const samples: Array<{
          phase: string;
          t: number;
          gfxMB: number;
          mallocMB: number;
        }> = [];
        const sample = (phase: string): void => {
          const led = readTileLedger(wcPid);
          if (led === null) return;
          samples.push({
            phase,
            t: Math.round((Date.now() - t0) / 100) / 10,
            ...led,
          });
        };
        const sampleFor = async (
          phase: string,
          secs: number,
          everyMs = 5_000,
        ): Promise<void> => {
          const end = Date.now() + secs * 1000;
          for (;;) {
            sample(phase);
            if (Date.now() + everyMs > end) return;
            await sleep(everyMs);
          }
        };
        const purgeCycles = async (phase: string): Promise<void> => {
          for (let c = 0; c < PURGE_CYCLES; c += 1) {
            Bun.spawnSync(["notifyutil", "-p", "org.WebKit.lowMemory"]);
            await sampleFor(phase, 8, 1_000);
            await sampleFor(phase, 22, 5_000);
          }
        };

        // Warm sweep in half-viewport steps so CM6 has materialized every
        // line at least once and the layer height is honest, mirroring the
        // transcript rig's warm pass.
        {
          const sh = await app.evalJS<number>(
            `${scroller}.scrollHeight - ${scroller}.clientHeight`,
          );
          const vh = await app.evalJS<number>(`${scroller}.clientHeight`);
          const step = Math.max(1, Math.round(vh / 2));
          for (let y = 0; y <= sh; y += step) {
            await app.evalJS<number>(
              `(function () { var el = ${scroller}; el.scrollTop = ${y}; return el.scrollTop; })()`,
            );
            await sleep(120);
          }
          await app.evalJS<number>(
            `(function () { var el = ${scroller}; el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); return el.scrollTop; })()`,
          );
        }

        const geom = await app.evalJS<{
          vw: number;
          vh: number;
          scrollHeight: number;
          nodes: number;
          dpr: number;
          visibility: string;
        }>(`(function () {
  var el = ${scroller};
  return {
    vw: el.clientWidth,
    vh: el.clientHeight,
    scrollHeight: el.scrollHeight,
    nodes: el.getElementsByTagName("*").length,
    dpr: window.devicePixelRatio,
    visibility: document.visibilityState,
  };
})()`);

        await sleep(2_000);
        await sampleFor("rest-editor", REST_SECS);
        await purgeCycles("purge-editor");

        // Probe-A: hide the pane frame (paint-only; layout, CM6 state and
        // the layer height all survive), settle, re-measure the floors.
        await app.evalJS<void>(
          `document.querySelector('.tug-pane[data-pane-id="pT"]').style.visibility = "hidden"`,
        );
        await sleep(2_000);
        await sampleFor("rest-hidden", REST_SECS);
        await purgeCycles("purge-hidden");

        await app.evalJS<void>(
          `document.querySelector('.tug-pane[data-pane-id="pT"]').style.visibility = ""`,
        );
        await sleep(2_000);
        await sampleFor("rest-revealed", 30);

        const byPhase: Record<
          string,
          { n: number; minMB: number; maxMB: number; meanMB: number }
        > = {};
        for (const s of samples) {
          const agg = (byPhase[s.phase] ??= {
            n: 0,
            minMB: Infinity,
            maxMB: -Infinity,
            meanMB: 0,
          });
          agg.n += 1;
          agg.minMB = Math.min(agg.minMB, s.gfxMB);
          agg.maxMB = Math.max(agg.maxMB, s.gfxMB);
          agg.meanMB += s.gfxMB;
        }
        for (const agg of Object.values(byPhase)) {
          agg.meanMB = Math.round(agg.meanMB / agg.n);
          agg.minMB = Math.round(agg.minMB);
          agg.maxMB = Math.round(agg.maxMB);
        }
        const report = { wcPid, heavyPath, geom, byPhase };
        console.log(`[at9996] EDITOR-TILE-LEDGER ${JSON.stringify(report)}`);
        writeFileSync(
          "/tmp/at9996-editor-tiles.json",
          JSON.stringify({ report, samples }, null, 2),
        );

        // Instrument sanity: the document is genuinely heavy, the window
        // stayed visible, and every phase produced readings.
        expect(geom.scrollHeight).toBeGreaterThan(10_000);
        expect(geom.visibility).toBe("visible");
        for (const phase of [
          "rest-editor",
          "purge-editor",
          "rest-hidden",
          "purge-hidden",
          "rest-revealed",
        ]) {
          expect(byPhase[phase]?.n ?? 0).toBeGreaterThan(0);
        }
      } finally {
        await app.close();
      }
    },
    900_000,
  );

  // -----------------------------------------------------------------------
  // Host surface ledger (roadmap/host-surface-accounting.md §G7). Every
  // other cell in this file measures WebContent. WebKit on macOS uses
  // UI-side compositing: `RemoteLayerTreeDrawingAreaProxy` hands the whole
  // CALayer tree to the APP process, which maps each layer's buffer set.
  // So the app process — not WebContent — holds the deck's composited
  // backing, and no instrument has ever read it.
  //
  // Reads both processes at once, per deck state:
  //
  //   empty      deck up, no transcript ingested — the chrome floor
  //   one        one heavy session card
  //   all        every session card heavy
  //   hidden     all panes visibility:hidden (the causal A/B: what the
  //              layer tree costs vs. what the window costs)
  //   revealed   restored, to prove the hidden read was reversible
  //
  // Foreground launch for the same reason as the tile cells: a background
  // window's backing is dropped by policy, which would measure occlusion
  // instead of cost. Results are reported in window-equivalents (one
  // full-window layer at dpr² × 4 B/px) so a lab window compares to the
  // user's 5K release instance.
  //
  // An instrument, not a regression gate.
  test.skipIf(process.env.AT9996_HOST_SURFACES !== "1")(
    "host surface ledger: UI-process layer backing by deck state",
    async () => {
      const TURNS = Number(process.env.AT9996_TILES_TURNS ?? "150");
      const REST_SECS = Number(process.env.AT9996_HOST_REST_SECS ?? "25");

      const sleep = (ms: number): Promise<void> =>
        new Promise((r) => setTimeout(r, ms));

      const priorWebContent = listWebContentPids();
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at9996-host-surfaces",
        env: { TUGBANK_PATH: tugbankPath },
        foreground: true,
      });
      try {
        // Required before anything awaits engine readiness: `isEngineReady`
        // answers by walking the deck-trace ring, so with tracing off no
        // `engine-ready` event is ever recorded and the wait can only time
        // out.
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        for (const id of SESSIONS) {
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered(${JSON.stringify(id)})`,
            { timeoutMs: 8_000 },
          );
        }

        // The app reports its own pid over RPC at launch, which is exact.
        // Identifying it by arrival races the bundle's helper executables
        // — a first run picked one up and dutifully measured its 24MB.
        const hostPid = app.hostPid;
        expect(hostPid).toBeGreaterThan(0);

        // WebContent has no such channel: it is launchd-parented, so
        // parentage cannot identify it and arrival must.
        let wcPid = -1;
        for (let i = 0; i < 40 && wcPid < 0; i += 1) {
          const fresh = [...listWebContentPids()].filter(
            (p) => !priorWebContent.has(p),
          );
          if (fresh.length === 1) wcPid = fresh[0]!;
          else await sleep(250);
        }
        expect(wcPid).toBeGreaterThan(0);

        // The reading has to exist; its magnitude is the measurement, not
        // an assumption. A first pass asserted "the app is never a few
        // tens of MB" and the assertion was simply wrong — a fresh lab app
        // reads ~25MB with no UI-side surfaces at all, which is the very
        // result this cell exists to report.
        const hostProbe = readHostGraphicsMB(hostPid);
        expect(hostProbe).not.toBeNull();
        const hostComm = Bun.spawnSync(["ps", "-o", "comm=", "-p", String(hostPid)])
          .stdout.toString()
          .trim();

        const samples: Array<{
          phase: string;
          hostGfxMB: number;
          hostFootMB: number;
          wcGfxMB: number;
        }> = [];
        const sample = (phase: string): void => {
          const host = readHostGraphicsMB(hostPid);
          const wc = readTileLedger(wcPid);
          if (host === null || wc === null) return;
          samples.push({
            phase,
            hostGfxMB: host.gfxMB,
            hostFootMB: host.footprintMB,
            wcGfxMB: wc.gfxMB,
          });
        };
        const sampleFor = async (phase: string, secs: number): Promise<void> => {
          const end = Date.now() + secs * 1000;
          for (;;) {
            sample(phase);
            if (Date.now() + 5_000 > end) return;
            await sleep(5_000);
          }
        };

        const geom = await app.evalJS<{
          vw: number;
          vh: number;
          dpr: number;
          visibility: string;
          panes: number;
          nodes: number;
        }>(`({
  vw: window.innerWidth,
  vh: window.innerHeight,
  dpr: window.devicePixelRatio,
  visibility: document.visibilityState,
  panes: document.querySelectorAll(".tug-pane").length,
  nodes: document.getElementsByTagName("*").length,
})`);
        // A visible window is the precondition for every backing-store read
        // (the 2026-08-01 lesson: a covered window reads hidden and its
        // tiles are dropped wholesale).
        expect(geom.visibility).toBe("visible");

        // Bind every engine BEFORE any sampling. `vmmap` takes a corpse of
        // the target, which suspends it for the duration — running that on
        // a 5s cadence while the app is still binding starved
        // `awaitEngineReady` past its fixed 20s deadline. Binding first
        // also makes `empty` a truer baseline: engines up, content zero.
        // `seedTranscriptTurns` re-binds, which is a fast path once bound.
        const PREFIX = "at9996-host-surfaces";
        for (const id of SESSIONS) {
          await app.bindSession(id, { tugSessionId: `${PREFIX}-${id}` });
          await app.awaitEngineReady(id, { timeoutMs: 60_000 });
        }

        await sampleFor("empty", REST_SECS);

        await seedTranscriptTurns(app, "A", TURNS, PREFIX);
        await sleep(2_000);
        await sampleFor("one", REST_SECS);

        for (const id of SESSIONS.slice(1)) {
          await seedTranscriptTurns(app, id, TURNS, PREFIX);
        }
        await sleep(2_000);
        await sampleFor("all", REST_SECS);

        const setPaneVisibility = (value: string): Promise<void> =>
          app.evalJS<void>(`(function () {
  var panes = document.querySelectorAll(".tug-pane");
  for (var i = 0; i < panes.length; i += 1) panes[i].style.visibility = ${JSON.stringify(value)};
})()`);
        await setPaneVisibility("hidden");
        await sleep(3_000);
        await sampleFor("hidden", REST_SECS);

        await setPaneVisibility("");
        await sleep(3_000);
        await sampleFor("revealed", REST_SECS);

        const byPhase: Record<
          string,
          { n: number; hostMB: number; hostMax: number; footMB: number; wcMB: number }
        > = {};
        for (const s of samples) {
          const b = (byPhase[s.phase] ??= {
            n: 0,
            hostMB: 0,
            hostMax: 0,
            footMB: 0,
            wcMB: 0,
          });
          b.n += 1;
          b.hostMB += s.hostGfxMB;
          b.hostMax = Math.max(b.hostMax, s.hostGfxMB);
          b.footMB += s.hostFootMB;
          b.wcMB += s.wcGfxMB;
        }
        // One full-window layer, in MB, at 4 bytes per device pixel — the
        // unit the brief reports in so lab and release windows compare.
        const windowMB =
          (geom.vw * geom.dpr * geom.vh * geom.dpr * 4) / (1024 * 1024);
        const report: Record<string, unknown> = {
          hostPid,
          hostComm,
          wcPid,
          geom,
          windowMB,
        };
        for (const [phase, b] of Object.entries(byPhase)) {
          report[phase] = {
            n: b.n,
            hostGfxMB: Math.round(b.hostMB / b.n),
            hostGfxMaxMB: Math.round(b.hostMax),
            hostFootprintMB: Math.round(b.footMB / b.n),
            wcGfxMB: Math.round(b.wcMB / b.n),
            hostWindowEquivalents:
              Math.round((b.hostMB / b.n / windowMB) * 10) / 10,
          };
        }
        console.log(`[at9996] HOST-SURFACE-LEDGER ${JSON.stringify(report)}`);
        writeFileSync(
          "/tmp/at9996-host-surfaces.json",
          `${JSON.stringify({ report, samples }, null, 2)}\n`,
        );

        for (const phase of ["empty", "one", "all", "hidden", "revealed"]) {
          expect(byPhase[phase]?.n ?? 0).toBeGreaterThan(0);
        }
      } finally {
        await app.close();
      }
    },
    900_000,
  );
});

// ---------------------------------------------------------------------------
// Tile-ledger sampling (§G2) — host-side process reads, no RPC involved.
// ---------------------------------------------------------------------------

function listWebContentPids(): Set<number> {
  const out = Bun.spawnSync(["pgrep", "-f", "com.apple.WebKit.WebContent"]);
  const pids = new Set<number>();
  for (const line of out.stdout.toString().split("\n")) {
    const pid = Number(line.trim());
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return pids;
}

/**
 * The app process's share of the deck's graphics. Under UI-side
 * compositing the app maps every composited layer's buffer set, and those
 * land in vmmap's `IOAccelerator (graphics)` summary row (dirty is its 5th
 * column) — a different row from WebContent's `owned unmapped memory`,
 * which is why `parseTileLedger` cannot read it.
 *
 * `vmmap` takes a corpse of its target, which suspends the process for the
 * duration: sample the app on a tight cadence while the harness is waiting
 * on it and the wait will time out.
 */
function readHostGraphicsMB(
  pid: number,
): { gfxMB: number; footprintMB: number } | null {
  const out = Bun.spawnSync(["vmmap", "--summary", String(pid)]);
  let gfxMB = NaN;
  let footprintMB = NaN;
  for (const line of out.stdout.toString().split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[0] === "IOAccelerator" && f[1] === "(graphics)") {
      gfxMB = parseVmmapSizeMB(f[4] ?? "");
    } else if (f[0] === "Physical" && f[1] === "footprint:") {
      footprintMB = parseVmmapSizeMB(f[2] ?? "");
    }
  }
  if (!Number.isFinite(gfxMB) || !Number.isFinite(footprintMB)) return null;
  return { gfxMB, footprintMB };
}

/** vmmap summary size token ("526.3M", "1.3G", "16K", "0K") → MB. */
function parseVmmapSizeMB(token: string): number {
  const m = /^([\d.]+)([KMG])?$/.exec(token);
  if (m === null) return NaN;
  const v = Number(m[1]);
  if (m[2] === "G") return v * 1024;
  if (m[2] === "M") return v;
  if (m[2] === "K") return v / 1024;
  return v / (1024 * 1024);
}

/**
 * Pull the two ledger lines out of a `vmmap --summary` dump: graphics is
 * the single "owned unmapped memory" region (the IOSurface pool; dirty is
 * its 6th column), malloc is the "WebKit Malloc" summary row (dirty 5th) —
 * NOT its "(reserved)" / "metadata" siblings.
 */
function parseTileLedger(
  summary: string,
): { gfxMB: number; mallocMB: number } | null {
  let gfxMB = NaN;
  let mallocMB = NaN;
  for (const line of summary.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[0] === "owned" && f[1] === "unmapped" && f[2] === "memory") {
      gfxMB = parseVmmapSizeMB(f[5] ?? "");
    } else if (
      f[0] === "WebKit" &&
      f[1] === "Malloc" &&
      /^[\d.]/.test(f[2] ?? "")
    ) {
      mallocMB = parseVmmapSizeMB(f[4] ?? "");
    }
  }
  if (!Number.isFinite(gfxMB) || !Number.isFinite(mallocMB)) return null;
  return { gfxMB, mallocMB };
}

function readTileLedger(
  pid: number,
): { gfxMB: number; mallocMB: number } | null {
  const out = Bun.spawnSync(["vmmap", "--summary", String(pid)]);
  return parseTileLedger(out.stdout.toString());
}

async function readTileLedgerAsync(
  pid: number,
): Promise<{ gfxMB: number; mallocMB: number } | null> {
  const proc = Bun.spawn(["vmmap", "--summary", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return parseTileLedger(text);
}
