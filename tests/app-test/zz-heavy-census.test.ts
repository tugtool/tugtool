/**
 * zz-heavy-census.test.ts — TEMPORARY. Cold-restores one of the user's
 * real heavy sessions (via the corpus reference-seeding path — content
 * never enters the repo) and then names every running animation and
 * samples the renderer at rest, reproducing the release-deck idle burn.
 *
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankWrite,
} from "./_harness/tugbank-helpers";
import { seedSnapshot } from "./corpus/resolve";
import type { SelectedSnapshot } from "./corpus/resolve";
import {
  openFixtureSession,
  waitForTranscriptSettled,
} from "./fixtures/runner";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 300_000;

const SESSION_ID = "8b8d7bf1-5d25-4b2d-95de-ee1ccba71d42";
const SOURCE_PATH = `${process.env.HOME}/.claude/projects/-Users-kocienda-Mounts-u-src-tugtool/${SESSION_ID}.jsonl`;

function referenceSnapshot(): SelectedSnapshot {
  const st = statSync(SOURCE_PATH);
  return {
    id: SESSION_ID,
    projectDir: "-Users-kocienda-Mounts-u-src-tugtool",
    sourcePath: SOURCE_PATH,
    bytes: st.size,
    mtimeMs: st.mtimeMs,
    class: "whale",
    shapes: ["tool-heavy"],
    primaryShape: "tool-heavy",
    stats: {} as never,
    pinned: false,
    largest: false,
    strategy: "reference",
    snapshotPath: null,
  } as unknown as SelectedSnapshot;
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
  const file = `/tmp/zz-heavy-census-${label}.txt`;
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
        const m = line.match(/(\d+) Web/);
        if (m) n += Number(m[1]);
      }
    }
    return n;
  };
  return {
    total: totalMatch ? Number(totalMatch[1]) : 0,
    idle: idleMatch ? Number(idleMatch[1]) : 0,
    treeResolver: count("Style::TreeResolver::resolve()"),
    compositingAfterStyle: count("updateCompositingLayersAfterStyleChange"),
    compositingAfterLayout: count("updateCompositingLayersAfterLayoutIfNeeded"),
    resizeObs: count("updateResizeObservations"),
    animTick: count("updateAnimationsAndSendEvents"),
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
    var easings = [];
    try {
      var kfs = e.getKeyframes();
      var seen = {};
      for (var i = 0; i < kfs.length; i++) {
        for (var k in kfs[i]) {
          if (k === 'offset' || k === 'computedOffset') continue;
          if (k === 'easing') { if (easings.indexOf(kfs[i][k]) < 0) easings.push(kfs[i][k]); continue; }
          if (k === 'composite') continue;
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
      easing: timing.easing,
      kfEasings: easings,
      props: props,
      target: (target ? target.tagName : '?') + '.' + String(cls).slice(0, 70),
    };
  });
})()`;

describe.skipIf(!SHOULD_RUN)("zz-heavy-census — real heavy session at rest", () => {
  test(
    "census + renderer sample after cold restore",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const seeded = await seedSnapshot(referenceSnapshot(), "zz-heavy");
      tugbankWrite(
        tugbankPath,
        "dev.tugtool.dev",
        "recent-projects",
        "json",
        JSON.stringify({ paths: [seeded.projectDir] }),
      );
      try {
        const app = await launchTugApp({
          testName: "zz-heavy-census",
          env: { TUGBANK_PATH: tugbankPath },
        });
        try {
          await openFixtureSession(
            app,
            {
              fixture: "zz-heavy",
              sessionId: SESSION_ID,
              projectDir: seeded.projectDir,
              seededClaudeDir: "",
              jsonlPath: "",
              cleanup: () => {},
            },
            { listTimeoutMs: 30_000 },
          );
          await waitForTranscriptSettled(app, "A", { timeoutMs: 120_000 });

          // Focus the composer, like a user about to type.
          await app.evalJS<void>(
            `(function(){
              var ed = document.querySelector('[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content');
              if (ed) ed.focus();
            })()`,
          );
          await new Promise((r) => setTimeout(r, 3000));

          const anims = await app.evalJS<unknown[]>(ALL_ANIMATIONS);
          console.log("ANIMATIONS (" + anims.length + "):");
          for (const a of anims) console.log("  ", JSON.stringify(a));

          const probe = await app.evalJS<unknown>(
            `(function(){
              if (!window.tugPerfMonitor || !window.tugPerfMonitor.layerTreeProbe) return null;
              var p = window.tugPerfMonitor.layerTreeProbe();
              return { elements: p.elements, maxDepth: p.maxDepth, stackingContexts: p.stackingContexts, willChange: p.willChange, contain: p.contain };
            })()`,
          );
          console.log("LAYER-PROBE:", JSON.stringify(probe));

          const breakdown = await app.evalJS<unknown>(
            `(function(){
              var dots = document.querySelectorAll('[data-slot="tug-progress-pulsing-dot"]').length;
              var entries = document.querySelectorAll('.tug-transcript-entry').length;
              var cells = document.querySelectorAll('.tug-list-view-cell');
              var skipped = 0;
              for (var i = 0; i < cells.length; i++) {
                if (getComputedStyle(cells[i]).contentVisibility === 'auto') skipped++;
              }
              // Histogram of stacking-context creators by class.
              var hist = {};
              var all = document.querySelectorAll('*');
              for (var j = 0; j < all.length; j++) {
                var el = all[j], cs = getComputedStyle(el);
                var isSC = cs.isolation === 'isolate' || cs.zIndex !== 'auto' && cs.position !== 'static' ||
                  cs.transform !== 'none' || cs.willChange.indexOf('transform') >= 0 ||
                  cs.willChange.indexOf('opacity') >= 0 || (cs.opacity !== '1' && cs.opacity !== '') ||
                  cs.filter !== 'none' || cs.contain.indexOf('paint') >= 0 || cs.position === 'sticky';
                if (!isSC) continue;
                var key = el.tagName + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ').slice(0,2).join('.');
                hist[key] = (hist[key] || 0) + 1;
              }
              var top = Object.keys(hist).map(function(k){ return [k, hist[k]]; })
                .sort(function(a,b){ return b[1]-a[1]; }).slice(0, 15);
              return { dots: dots, entries: entries, cells: cells.length, cvAuto: skipped, topStackingContexts: top };
            })()`,
          );
          console.log("BREAKDOWN:", JSON.stringify(breakdown));

          const pid = newestWebContentPid();
          console.log("SAMPLING WebContent pid", pid);
          const s = samplePhase(pid, "heavy");
          const busy =
            s.total > 0
              ? (((s.total - s.idle) / s.total) * 100).toFixed(1) + "%"
              : "?";
          console.log("SAMPLE:", JSON.stringify(s), "busy=" + busy);

          expect(anims).toBeDefined();
        } finally {
          await app.close();
        }
      } finally {
        seeded.cleanup();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
