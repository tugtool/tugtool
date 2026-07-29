/**
 * zz-deck-census.test.ts — TEMPORARY. Reproduces the user's release deck
 * shape (session cards + text card + lens), then names every running
 * animation via animationCensus() and samples the renderer to see
 * whether a session-card deck burns at rest.
 *
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

function userShapedDeck() {
  const sessions = ["S1", "S2", "S3"].map((id) => ({
    id,
    componentId: "session",
    title: `Session ${id}`,
    closable: true,
  }));
  return {
    cards: [
      ...sessions,
      { id: "T1", componentId: "text", title: "File", closable: true },
    ],
    panes: [
      ...["S1", "S2", "S3"].map((id, i) => ({
        id: `p${id}`,
        position: { x: 40 + i * 40, y: 40 + i * 30 },
        size: { width: 720, height: 600 },
        cardIds: [id],
        activeCardId: id,
        title: "",
        acceptsFamilies: ["maker"],
      })),
      {
        id: "pT1",
        position: { x: 200, y: 200 },
        size: { width: 640, height: 500 },
        cardIds: ["T1"],
        activeCardId: "T1",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pS1",
    hasFocus: true,
  };
}

function newestWebContentPid(): number {
  const out = execSync(
    `ps -Ao pid,lstart,comm | grep 'WebKit.WebContent' | grep -v grep`,
    { encoding: "utf8" },
  );
  const rows = out
    .trim()
    .split("\n")
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(.+?)\s+\/System/);
      if (!m) return null;
      return { pid: Number(m[1]), started: new Date(m[2]).getTime() };
    })
    .filter((r): r is { pid: number; started: number } => r !== null)
    .sort((a, b) => b.started - a.started);
  if (rows.length === 0) throw new Error("no WebContent processes found");
  return rows[0].pid;
}

function samplePhase(pid: number, label: string) {
  const file = `/tmp/zz-deck-census-${label}.txt`;
  execSync(`sample ${pid} 5 -file ${file}`, { stdio: "ignore" });
  const text = readFileSync(file, "utf8");
  const mainEnd = text.indexOf("Thread_", text.indexOf("DispatchQueue_1") + 1);
  const main = mainEnd > 0 ? text.slice(0, mainEnd) : text;
  const totalMatch = main.match(/(\d+) Thread_\d+\s+DispatchQueue_1/);
  const idleMatch = main.match(/(\d+) mach_msg2_trap/);
  const count = (needle: string): number => {
    let n = 0;
    for (const line of main.split("\n")) {
      if (line.includes(needle)) {
        const m = line.match(/(\d+) WebCore|(\d+) WebKit/);
        if (m) n += Number(m[1] ?? m[2] ?? 0);
      }
    }
    return n;
  };
  return {
    total: totalMatch ? Number(totalMatch[1]) : 0,
    idle: idleMatch ? Number(idleMatch[1]) : 0,
    treeResolver: count("Style::TreeResolver::resolve()"),
    compositingAfterStyle: count("updateCompositingLayersAfterStyleChange"),
    resizeObs: count("updateResizeObservations"),
    updateRendering: count("RemoteLayerTreeDrawingArea::updateRendering"),
  };
}

const ALL_ANIMATIONS = `(function(){
  var anims = document.getAnimations();
  return anims.map(function(a){
    var e = a.effect;
    var target = e && e.target ? e.target : null;
    var cls = target ? (target.className && target.className.baseVal !== undefined ? target.className.baseVal : String(target.className)) : '?';
    var timing = e ? e.getTiming() : {};
    var props = [];
    try {
      var kfs = e.getKeyframes();
      var seen = {};
      for (var i = 0; i < kfs.length; i++) {
        for (var k in kfs[i]) {
          if (k === 'offset' || k === 'easing' || k === 'composite' || k === 'computedOffset') continue;
          seen[k] = 1;
        }
      }
      props = Object.keys(seen);
    } catch (err) { props = ['?']; }
    return {
      kind: a.constructor.name,
      name: a.animationName || a.id || '(waapi)',
      state: a.playState,
      iter: timing.iterations === Infinity ? 'inf' : timing.iterations,
      duration: timing.duration,
      easing: timing.easing,
      props: props,
      target: (target ? target.tagName : '?') + '.' + String(cls).slice(0, 60),
    };
  });
})()`;

describe.skipIf(!SHOULD_RUN)("zz-deck-census — session deck at rest", () => {
  test(
    "census + renderer sample of a user-shaped deck",
    async () => {
      const app = await launchTugApp({ testName: "zz-deck-census" });
      try {
        await app.seedDeckState({
          state: userShapedDeck(),
          focusCardId: "S1",
        });
        await app.waitForCondition<boolean>(`document.hasFocus()`, {
          timeoutMs: 6_000,
        });
        for (const id of ["S1", "S2", "S3"]) {
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("${id}")`,
            { timeoutMs: 10_000 },
          );
          await app.bindSession(id);
        }
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-card-id="S1"] [data-slot="tug-text-editor"] .cm-content') !== null`,
          { timeoutMs: 20_000 },
        );

        // Focus the composer in S1, like a user about to type.
        await app.evalJS<void>(
          `(function(){
            var ed = document.querySelector('[data-card-id="S1"] [data-slot="tug-text-editor"] .cm-content');
            if (ed) ed.focus();
          })()`,
        );
        await new Promise((r) => setTimeout(r, 2000));

        const anims = await app.evalJS<unknown[]>(ALL_ANIMATIONS);
        console.log("ANIMATIONS (" + anims.length + "):");
        for (const a of anims) console.log("  ", JSON.stringify(a));

        const pid = newestWebContentPid();
        console.log("SAMPLING WebContent pid", pid);
        const s = samplePhase(pid, "session-deck");
        const busy =
          s.total > 0
            ? (((s.total - s.idle) / s.total) * 100).toFixed(1) + "%"
            : "?";
        console.log("SAMPLE:", JSON.stringify(s), "busy=" + busy);

        expect(anims).toBeDefined();
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
