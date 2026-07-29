/**
 * at0288 — motion residency census: what animates, and where.
 *
 * This test is an instrument AND a gate. The residency contract lives in
 * `animationCensus()` (tugdeck/src/lib/perf-monitor.ts) — there is no
 * doctrine document yet, so the census IS the contract. It says a
 * long-running animation must
 * touch only `transform`/`opacity`, must target an element that can hold
 * a compositing layer, must not share its box with a non-accelerable
 * property, and must carry only timing functions the compositor can
 * express as a cubic Bézier — a multi-stop `linear()` demotes the whole
 * animation to main-thread blending (`steps()` does not; measured
 * 2026-07-29). One hygiene rule rides alongside: no finished
 * `CSSTransition`s retained in `getAnimations()` at rest — a retained
 * population means some component wrote a transitioned property through
 * a live transition outside a designed crossing, and the animation
 * controller iterates the retained list every rendering update. The
 * census reports every long-running animation, the rules each one
 * breaks, and the retained-transition count; both decks here assert
 * `violations` empty.
 *
 * Two decks are censused in one launch so their outputs subtract:
 *
 *   1. An EMPTY deck — no cards at all, asserted, not assumed. Anything
 *      the census reports here is persistent chrome or the engine's own
 *      machinery, and it is the only surface on which an empty deck can
 *      cost anything.
 *   2. The same deck with `gallery-tug-progress-indicator` seeded, whose
 *      running glyph variants are the animations the contract was
 *      written for.
 *
 * The full census is printed, not just the violations: the diagnostic
 * value is the list of names, and a violation-only view hides an
 * accelerated loop that still forces per-frame compositing work.
 *
 * `layerTreeProbe()` is read alongside it because the census measures
 * only the TRIGGER. WebKit's compositing-requirements pass recurses over
 * the layer tree and re-derives clip rects against every ancestor, so
 * what a dirty frame COSTS is a function of depth and stacking-context
 * count — which a window resize pays whether or not anything animates.
 * Printing both against the same two decks is what lets the trigger and
 * the bill be told apart.
 *
 * @covers tugdeck/src/lib/perf-monitor.ts
 * @covers tugdeck/src/components/tugways/cards/gallery-tug-progress-indicator.tsx
 * @covers tugdeck/src/components/tugways/tug-progress-indicator.tsx
 * @covers tugdeck/src/components/tugways/internal/tug-progress-spinner.tsx
 * @covers tugdeck/src/components/tugways/internal/tug-progress-ring.css
 * @covers tugdeck/src/components/tugways/internal/tug-progress-pulsing-dot.tsx
 * @covers tugdeck/src/components/tugways/tug-skeleton.css
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

interface CensusEntry {
  name: string;
  kind: string;
  target: string;
  properties: string[];
  coAnimatedProperties: string[];
  playState: string;
  iterations: number | null;
  durationMs: number | null;
  timingFunctions: string[];
  svgTarget: boolean;
  violations: string[];
}

interface RawEntry {
  name: string;
  target: string;
  playState: string;
  durationMs: number | null;
  iterations: number | null;
  properties: string[];
}

interface LayerTree {
  elements: number;
  maxDepth: number;
  meanDepth: number;
  depthHistogram: Record<string, number>;
  stackingContexts: number;
  maxStackingDepth: number;
  deepestStackingPath: string[];
  willChange: number;
  contained: number;
  transform3d: number;
}

interface Probe {
  /** Mounted card hosts — 0 proves the empty deck is really empty. */
  cardHosts: number;
  total: number;
  longRunning: number;
  entries: CensusEntry[];
  violations: CensusEntry[];
  /** Finished `CSSTransition`s still retained in `getAnimations()`. */
  retainedTransitions: { count: number; targets: string[] };
  /** Everything `getAnimations()` reports, long-running or not. */
  raw: RawEntry[];
  /** The structure a dirty frame has to walk. */
  layers: LayerTree;
}

/**
 * Reads the census plus a raw `getAnimations()` dump. The raw list is
 * wider than the census on purpose: the census filters to long-running
 * effects, and a short effect that re-arms every frame would otherwise
 * be invisible.
 */
const PROBE = `(function(){
  var census = window.tugPerfMonitor.animationCensus();
  function describe(effect) {
    var t = effect && effect.target;
    if (!t) return "<no target>";
    var head = t.tagName.toLowerCase();
    if (t.classList.length > 0) head += "." + Array.from(t.classList).join(".");
    return effect.pseudoElement ? head + effect.pseudoElement : head;
  }
  var raw = document.getAnimations().map(function (a) {
    var effect = a.effect;
    var timing = effect && effect.getTiming ? effect.getTiming() : {};
    var props = {};
    if (effect && effect.getKeyframes) {
      effect.getKeyframes().forEach(function (frame) {
        Object.keys(frame).forEach(function (key) {
          if (key !== "offset" && key !== "computedOffset" &&
              key !== "easing" && key !== "composite") props[key] = true;
        });
      });
    }
    var iterations = timing.iterations === undefined ? 1 : timing.iterations;
    return {
      name: a.animationName || a.id || a.constructor.name,
      target: describe(effect),
      playState: a.playState,
      durationMs: typeof timing.duration === "number" ? timing.duration : null,
      iterations: iterations === Infinity ? null : iterations,
      properties: Object.keys(props).sort(),
    };
  });
  return {
    cardHosts: document.querySelectorAll("[data-card-host]").length,
    total: census.total,
    longRunning: census.longRunning,
    entries: census.entries,
    violations: census.violations,
    retainedTransitions: census.retainedTransitions,
    raw: raw,
    layers: window.tugPerfMonitor.layerTreeProbe(),
  };
})()`;

function report(label: string, probe: Probe): void {
  const lines = [
    `\n=== census: ${label} ===`,
    `card hosts: ${probe.cardHosts}`,
    `animations: ${probe.total} total, ${probe.longRunning} long-running, ` +
      `${probe.violations.length} in violation`,
    `retained finished transitions: ${probe.retainedTransitions.count}` +
      (probe.retainedTransitions.targets.length > 0
        ? ` (${probe.retainedTransitions.targets.join(", ")})`
        : ""),
    "",
    "-- long-running (the contract's scope) --",
  ];
  if (probe.entries.length === 0) {
    lines.push("  (none)");
  }
  for (const e of probe.entries) {
    const dur = e.durationMs === null ? "?" : `${Math.round(e.durationMs)}ms`;
    const iter = e.iterations === null ? "∞" : String(e.iterations);
    lines.push(
      `  ${e.name} [${e.kind}] ${e.playState} ${dur} ×${iter}`,
      `      target: ${e.target}`,
      `      animates: ${e.properties.join(", ") || "(nothing)"}` +
        (e.coAnimatedProperties.length > 0
          ? ` | co-animated: ${e.coAnimatedProperties.join(", ")}`
          : ""),
      `      timing: ${e.timingFunctions.join(", ") || "(default)"} | svg: ${e.svgTarget}`,
      `      violations: ${e.violations.join("; ") || "none"}`,
    );
  }
  const l = probe.layers;
  lines.push(
    "",
    "-- layer tree (what a dirty frame walks) --",
    `  elements: ${l.elements} | depth max ${l.maxDepth}, mean ${l.meanDepth}`,
    `  stacking contexts: ${l.stackingContexts} | deepest chain: ${l.maxStackingDepth}`,
    `  will-change: ${l.willChange} | contain: ${l.contained} | 3D transforms: ${l.transform3d}`,
    `  depth histogram: ${JSON.stringify(l.depthHistogram)}`,
    `  deepest chain: ${l.deepestStackingPath.join(" > ")}`,
  );
  lines.push("", "-- every animation, long-running or not --");
  if (probe.raw.length === 0) {
    lines.push("  (none)");
  }
  for (const r of probe.raw) {
    const dur = r.durationMs === null ? "?" : `${Math.round(r.durationMs)}ms`;
    const iter = r.iterations === null ? "∞" : String(r.iterations);
    lines.push(
      `  ${r.name} ${r.playState} ${dur} ×${iter} — ${r.target}` +
        ` [${r.properties.join(", ") || "no properties"}]`,
    );
  }
  console.log(lines.join("\n"));
}

const GALLERY_CARD = {
  id: "A",
  componentId: "gallery-tug-progress-indicator",
  title: "TugProgressIndicator",
  closable: true,
};

const GALLERY_PANE = {
  id: "p1",
  position: { x: 40, y: 40 },
  size: { width: 720, height: 620 },
  cardIds: ["A"],
  activeCardId: "A",
  title: "",
  acceptsFamilies: ["maker"],
};

describe.skipIf(!SHOULD_RUN)("at0288: motion residency census", () => {
  test(
    "the census names every long-running animation, on an empty deck and a seeded one",
    async () => {
      const app = await launchTugApp({ testName: "at0288-motion-residency" });
      try {
        // --- empty deck -------------------------------------------------
        await app.seedDeckState({
          state: {
            cards: [],
            panes: [],
            activePaneId: undefined,
            hasFocus: true,
          },
        });
        // Assert the emptiness rather than trusting the seed: an earlier
        // measurement of an "empty" deck was never confirmed to have
        // applied, and every conclusion drawn from it rested on that.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll("[data-card-host]").length === 0`,
          { timeoutMs: 6000 },
        );
        // Let mount/teardown transitions retire so what remains is what
        // the app runs at rest.
        await new Promise((r) => setTimeout(r, 1_500));

        const empty = await app.evalJS<Probe>(PROBE);
        report("empty deck", empty);
        expect(empty.cardHosts).toBe(0);
        expect(
          empty.violations,
          `empty-deck residency violations:\n${JSON.stringify(empty.violations, null, 2)}`,
        ).toEqual([]);
        expect(empty.retainedTransitions.count).toBe(0);

        // --- seeded deck ------------------------------------------------
        await app.seedDeckState({
          state: {
            cards: [GALLERY_CARD],
            panes: [GALLERY_PANE],
            activePaneId: "p1",
            hasFocus: true,
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `document.querySelector(".tug-progress-indicator") !== null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(
          `window.tugPerfMonitor.animationCensus().longRunning > 0`,
          { timeoutMs: 6000 },
        );
        await new Promise((r) => setTimeout(r, 1_500));

        const seeded = await app.evalJS<Probe>(PROBE);
        report("gallery-tug-progress-indicator", seeded);
        expect(seeded.cardHosts).toBeGreaterThan(0);

        // The floor: a card full of running glyphs animates more than an
        // empty deck does — a motion-off environment or a failed card
        // mount must read as a failure, never a vacuous pass.
        expect(
          seeded.longRunning,
          "seeding a card of running indicators added no long-running animations",
        ).toBeGreaterThan(empty.longRunning);
        // The gate: every long-running animation compliant, and no
        // finished transitions retained after the settle window.
        expect(
          seeded.violations,
          `seeded-deck residency violations:\n${JSON.stringify(seeded.violations, null, 2)}`,
        ).toEqual([]);
        expect(seeded.retainedTransitions.count).toBe(0);
        // The layer probe reads a real tree, not an empty one — a probe
        // that silently returned zeros would otherwise look like good news.
        expect(empty.layers.elements).toBeGreaterThan(0);
        expect(seeded.layers.elements).toBeGreaterThan(empty.layers.elements);
        expect(seeded.layers.maxStackingDepth).toBeGreaterThan(0);
      } finally {
        await app.quitGracefully();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
