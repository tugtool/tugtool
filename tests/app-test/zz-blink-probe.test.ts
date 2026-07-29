/**
 * zz-blink-probe.test.ts — TEMPORARY. Measures the renderer cost of the
 * text-editor caret blink under three timing treatments: the shipped
 * `steps(1)` easing, a keyframe-native linear replacement, and no
 * animation (control). Samples the WebContent process 5s per phase and
 * reports the style/compositing frame counts.
 *
 * @covers tugdeck/src/components/tugways/tug-text-editor/theme.ts
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

function editorDeck() {
  return {
    cards: [
      {
        id: "E",
        componentId: "gallery-text-editor",
        title: "Editor",
        closable: true,
      },
    ],
    panes: [
      {
        id: "pE",
        position: { x: 60, y: 60 },
        size: { width: 640, height: 480 },
        cardIds: ["E"],
        activeCardId: "E",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pE",
    imposition: { kind: "one-up", lens: "right" },
    hasFocus: true,
  };
}

/** Newest WebContent process on the machine — the one our app just spawned. */
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

interface PhaseCounts {
  total: number;
  idle: number;
  treeResolver: number;
  applyKeyframes: number;
  compositingWalk: number;
  updateRendering: number;
}

function samplePhase(pid: number, label: string): PhaseCounts {
  const file = `/tmp/zz-blink-probe-${label}.txt`;
  execSync(`sample ${pid} 5 -file ${file}`, { stdio: "ignore" });
  const text = readFileSync(file, "utf8");
  // Main-thread section only: everything before the first worker thread.
  const mainEnd = text.indexOf("Thread_", text.indexOf("DispatchQueue_1") + 1);
  const main = mainEnd > 0 ? text.slice(0, mainEnd) : text;
  const totalMatch = main.match(/(\d+) Thread_\d+\s+DispatchQueue_1/);
  const idleMatch = main.match(/(\d+) mach_msg2_trap/);
  const count = (re: RegExp): number => {
    let n = 0;
    for (const line of main.split("\n")) {
      const m = line.match(re);
      if (m) n += Number(m[1] ?? 0);
    }
    return n;
  };
  return {
    total: totalMatch ? Number(totalMatch[1]) : 0,
    idle: idleMatch ? Number(idleMatch[1]) : 0,
    treeResolver: count(/(\d+) WebCore::Style::TreeResolver::resolve\(\)/),
    applyKeyframes: count(/(\d+) WebCore::Style::Resolver.*applyKeyframeEffects|(\d+) .*applyKeyframeEffects/),
    compositingWalk: count(
      /(\d+) WebCore::LocalFrameViewLayoutContext::updateCompositingLayersAfterStyleChange/,
    ),
    updateRendering: count(
      /(\d+) WebKit::RemoteLayerTreeDrawingArea::updateRendering/,
    ),
  };
}

const FOCUS_EDITOR = `(function(){
  var content = document.querySelector('.cm-content');
  if (!content) return 'no-cm-content';
  content.focus();
  return 'focused';
})()`;

const BLINK_RUNNING = `(function(){
  var layer = document.querySelector('.cm-editor.cm-focused .tug-text-editor-caret-layer');
  if (!layer) return 'no-focused-caret-layer';
  var anims = layer.getAnimations();
  if (anims.length === 0) return 'no-animation';
  return anims.map(function(a){
    var t = a.effect.getTiming();
    return a.animationName + ' ' + a.playState + ' easing=' + t.easing + ' iter=' + t.iterations;
  }).join('; ');
})()`;

const OVERRIDE_LINEAR = `(function(){
  var style = document.createElement('style');
  style.id = 'zz-blink-override';
  style.textContent = [
    '@keyframes zz-probe-blink {',
    '  0% { opacity: 1 } 49.9% { opacity: 1 }',
    '  50% { opacity: 0 } 99.9% { opacity: 0 }',
    '  100% { opacity: 1 }',
    '}',
    '.cm-editor.cm-focused > .cm-scroller > .tug-text-editor-caret-layer {',
    '  animation: zz-probe-blink 1.2s linear infinite !important;',
    '}'
  ].join('\\n');
  document.head.appendChild(style);
  return 'linear-override-installed';
})()`;

const OVERRIDE_NONE = `(function(){
  var el = document.getElementById('zz-blink-override');
  if (el) el.textContent =
    '.cm-editor.cm-focused > .cm-scroller > .tug-text-editor-caret-layer { animation: none !important; }';
  return 'none-override-installed';
})()`;

describe.skipIf(!SHOULD_RUN)("zz-blink-probe — caret blink renderer cost", () => {
  test(
    "steps(1) vs keyframe-native linear vs none",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "zz-blink-probe",
          env: { TUGBANK_PATH: tugbankPath },
        });
        try {
          await app.seedDeckState({ state: editorDeck(), focusCardId: "E" });
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });
          await app.waitForCondition<boolean>(
            `document.querySelector('.cm-content') !== null`,
            { timeoutMs: 8_000 },
          );

          const focusResult = await app.evalJS<string>(FOCUS_EDITOR);
          console.log("FOCUS:", focusResult);
          await app.waitForCondition<boolean>(
            `document.querySelector('.cm-editor.cm-focused') !== null`,
            { timeoutMs: 4_000 },
          );

          const blinkState = await app.evalJS<string>(BLINK_RUNNING);
          console.log("BLINK:", blinkState);
          expect(blinkState).toContain("running");

          const pid = newestWebContentPid();
          console.log("SAMPLING WebContent pid", pid);

          // Let things settle, then phase A: shipped steps(1).
          await new Promise((r) => setTimeout(r, 1500));
          const a = samplePhase(pid, "steps");
          console.log("PHASE-A steps(1):", JSON.stringify(a));

          // Phase B: keyframe-native linear.
          console.log("OVERRIDE:", await app.evalJS<string>(OVERRIDE_LINEAR));
          console.log("BLINK-B:", await app.evalJS<string>(BLINK_RUNNING));
          await new Promise((r) => setTimeout(r, 1500));
          const b = samplePhase(pid, "linear");
          console.log("PHASE-B linear:", JSON.stringify(b));

          // Phase C: control, no animation.
          console.log("OVERRIDE:", await app.evalJS<string>(OVERRIDE_NONE));
          await new Promise((r) => setTimeout(r, 1500));
          const c = samplePhase(pid, "none");
          console.log("PHASE-C none:", JSON.stringify(c));

          const busyPct = (p: PhaseCounts): string =>
            p.total > 0
              ? (((p.total - p.idle) / p.total) * 100).toFixed(1) + "%"
              : "?";
          console.log(
            `VERDICT busy A=${busyPct(a)} B=${busyPct(b)} C=${busyPct(c)}` +
              ` | treeResolver A=${a.treeResolver} B=${b.treeResolver} C=${c.treeResolver}` +
              ` | compositingWalk A=${a.compositingWalk} B=${b.compositingWalk} C=${c.compositingWalk}`,
          );
          expect(a.total).toBeGreaterThan(0);
        } finally {
          await app.close();
        }
      } finally {
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
