/**
 * at0291 — the perf instruments see what they claim to see.
 *
 * Three censuses in `tugdeck/src/lib/perf-monitor.ts` exist to attribute
 * renderer cost that a sampling profiler cannot: `sample` shows the style
 * resolution but never the mutation that dirtied the tree, and it shows
 * `Page::updateRendering` but never who scheduled it. The censuses close
 * that gap — the waker census counts what asks for a wake and from where,
 * the mutation census counts what writes to the DOM and to which target,
 * and the layer probe's candidate count is the denominator the compositing
 * walk actually recurses over.
 *
 * An instrument that reads zero is indistinguishable from a quiet app, so
 * every assertion here is an ANTI-VACUITY FLOOR: a deliberate wake, a
 * deliberate write, and a deliberately heavier deck, each of which the
 * instrument must report. A census that silently stopped working would
 * otherwise read as good news forever, which is exactly the failure the
 * gates built on top of these (idle silence, typing latency) cannot
 * tolerate.
 *
 * @covers tugdeck/src/lib/perf-monitor.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/** The deliberate interval's period; 1s of it must read ~20 fires. */
const PROBE_INTERVAL_MS = 50;
/** Every census window in this test. */
const CENSUS_WINDOW_MS = 1_000;
/** Deliberate DOM writes performed inside the mutation window. */
const PROBE_WRITES = 10;

interface WakerEntry {
  kind: string;
  callsite: string;
  activeCount: number;
  firesPerSecond: number;
  periodMs: number | null;
}

interface WakerCensus {
  windowMs: number;
  entries: WakerEntry[];
  totalFiresPerSecond: number;
}

interface MutationCensus {
  windowMs: number;
  totalWrites: number;
  writesPerSecond: number;
  byTarget: [string, number][];
  byType: { childList: number; attributes: number; characterData: number };
}

interface LayerTree {
  elements: number;
  stackingContexts: number;
  renderLayerCandidates: number;
  renderLayerHistogram: [string, number][];
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

describe.skipIf(!SHOULD_RUN)("at0291: perf instruments", () => {
  test(
    "the waker, mutation, and layer-candidate censuses each report a deliberate signal",
    async () => {
      const app = await launchTugApp({ testName: "at0291-perf-instruments" });
      try {
        await app.seedDeckState({
          state: {
            cards: [],
            panes: [],
            activePaneId: undefined,
            hasFocus: true,
          },
        });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll("[data-card-host]").length === 0`,
          { timeoutMs: 6_000 },
        );
        // Let mount/teardown churn retire so the quiet window is quiet for
        // the app's own reasons, not because we measured mid-settle.
        await new Promise((r) => setTimeout(r, 1_500));

        // --- waker census -------------------------------------------------
        // `evaluateJavaScript` returns the value, not the promise, so every
        // async census is kicked off into a window slot and collected once
        // it resolves.
        await app.evalJS<void>(`(function(){
          window.__at0291 = {};
          window.tugPerfMonitor.startWakerCensus();
          window.__at0291.intervalId = window.setInterval(function(){}, ${PROBE_INTERVAL_MS});
          window.tugPerfMonitor.readWakerCensus(${CENSUS_WINDOW_MS}).then(function(r){
            window.__at0291.waker = r;
          });
        })()`);
        await app.waitForCondition<boolean>(
          `window.__at0291.waker !== undefined`,
          { timeoutMs: 10_000 },
        );
        const waker = await app.evalJS<WakerCensus>(`window.__at0291.waker`);
        await app.evalJS<void>(`(function(){
          window.clearInterval(window.__at0291.intervalId);
          window.tugPerfMonitor.stopWakerCensus();
        })()`);

        console.log(
          [
            "\n=== waker census (empty deck + one deliberate 50ms interval) ===",
            `window: ${waker.windowMs}ms | total ${waker.totalFiresPerSecond} fires/s`,
            ...waker.entries.map(
              (e) =>
                `  ${e.kind} ${e.periodMs === null ? "raf" : `${e.periodMs}ms`}` +
                ` ×${e.activeCount} active — ${e.firesPerSecond}/s` +
                `\n      ${e.callsite}`,
            ),
          ].join("\n"),
        );

        const probeWaker = waker.entries.find(
          (e) => e.kind === "interval" && e.periodMs === PROBE_INTERVAL_MS,
        );
        expect(
          probeWaker,
          `the deliberate ${PROBE_INTERVAL_MS}ms interval is missing from the census:\n` +
            JSON.stringify(waker, null, 2),
        ).toBeDefined();
        const expectedFires = 1_000 / PROBE_INTERVAL_MS;
        // Generous either side of 20/s: WebKit clamps and coalesces timers,
        // and the point of the floor is "the census counts fires", not
        // "WebKit keeps perfect time".
        expect(probeWaker?.firesPerSecond).toBeGreaterThan(expectedFires * 0.5);
        expect(probeWaker?.firesPerSecond).toBeLessThan(expectedFires * 1.5);
        expect(probeWaker?.activeCount).toBe(1);
        expect(probeWaker?.callsite.length).toBeGreaterThan(0);
        expect(probeWaker?.callsite).not.toBe("<no stack>");

        // The natives must be back after `stopWakerCensus` — a test that
        // leaves the timer primitives shimmed poisons everything after it.
        const unwrapped = await app.evalJS<boolean>(
          `window.setInterval.toString().indexOf("[native code]") !== -1`,
        );
        expect(unwrapped, "stopWakerCensus left window.setInterval wrapped").toBe(
          true,
        );

        // --- mutation census ----------------------------------------------
        await app.evalJS<void>(`(function(){
          var el = document.createElement("div");
          el.className = "at0291-probe";
          el.style.position = "absolute";
          el.style.left = "-9999px";
          document.body.appendChild(el);
          window.__at0291.el = el;
          window.tugPerfMonitor.mutationCensus(${CENSUS_WINDOW_MS}).then(function(r){
            window.__at0291.loud = r;
          });
          for (var i = 0; i < ${PROBE_WRITES}; i++) el.textContent = "write " + i;
        })()`);
        await app.waitForCondition<boolean>(
          `window.__at0291.loud !== undefined`,
          { timeoutMs: 10_000 },
        );
        const loud = await app.evalJS<MutationCensus>(`window.__at0291.loud`);

        await app.evalJS<void>(`(function(){
          window.tugPerfMonitor.mutationCensus(${CENSUS_WINDOW_MS}).then(function(r){
            window.__at0291.quiet = r;
          });
        })()`);
        await app.waitForCondition<boolean>(
          `window.__at0291.quiet !== undefined`,
          { timeoutMs: 10_000 },
        );
        const quiet = await app.evalJS<MutationCensus>(`window.__at0291.quiet`);
        await app.evalJS<void>(
          `window.__at0291.el.remove()`,
        );

        for (const [label, census] of [
          ["with deliberate writes", loud],
          ["quiet window, same DOM", quiet],
        ] as [string, MutationCensus][]) {
          console.log(
            [
              `\n=== mutation census: ${label} ===`,
              `${census.totalWrites} writes in ${census.windowMs}ms ` +
                `(${census.writesPerSecond}/s) — ` +
                `childList ${census.byType.childList}, ` +
                `attributes ${census.byType.attributes}, ` +
                `characterData ${census.byType.characterData}`,
              ...census.byTarget.map(([bucket, n]) => `  ${n}  ${bucket}`),
            ].join("\n"),
          );
        }

        const probeBucket = loud.byTarget.find(
          ([bucket]) => bucket === "div.at0291-probe",
        );
        expect(
          probeBucket,
          `the deliberate writes are missing from the census:\n${JSON.stringify(loud, null, 2)}`,
        ).toBeDefined();
        // `textContent =` removes the old text node and inserts a new one,
        // so each write is a childList mutation on the probe element. The
        // first write has no node to remove, hence ≥ writes − 1.
        expect(probeBucket?.[1]).toBeGreaterThanOrEqual(PROBE_WRITES - 1);
        expect(loud.byType.childList).toBeGreaterThanOrEqual(PROBE_WRITES - 1);

        // The instrument distinguishes writing from not writing: with the
        // same element in the same DOM and nobody touching it, its bucket
        // is gone. (This is not the idle-silence gate — the deck at large
        // is allowed to be noisy here; only the probe must fall silent.)
        expect(
          quiet.byTarget.find(([bucket]) => bucket === "div.at0291-probe"),
          `the probe element kept mutating with nothing writing to it:\n${JSON.stringify(quiet, null, 2)}`,
        ).toBeUndefined();

        // --- layer candidates ----------------------------------------------
        const emptyLayers = await app.evalJS<LayerTree>(
          `window.tugPerfMonitor.layerTreeProbe()`,
        );
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
          { timeoutMs: 6_000 },
        );
        await new Promise((r) => setTimeout(r, 1_500));
        const seededLayers = await app.evalJS<LayerTree>(
          `window.tugPerfMonitor.layerTreeProbe()`,
        );

        for (const [label, layers] of [
          ["empty deck", emptyLayers],
          ["gallery-tug-progress-indicator", seededLayers],
        ] as [string, LayerTree][]) {
          console.log(
            [
              `\n=== layer candidates: ${label} ===`,
              `elements ${layers.elements} | stacking contexts ` +
                `${layers.stackingContexts} | RenderLayer candidates ` +
                `${layers.renderLayerCandidates}`,
              ...layers.renderLayerHistogram.map(
                ([bucket, n]) => `  ${n}  ${bucket}`,
              ),
            ].join("\n"),
          );
        }

        expect(emptyLayers.renderLayerCandidates).toBeGreaterThan(0);
        expect(
          seededLayers.renderLayerCandidates,
          "seeding a card added no RenderLayer candidates",
        ).toBeGreaterThan(emptyLayers.renderLayerCandidates);
        expect(seededLayers.renderLayerHistogram.length).toBeGreaterThan(0);
        // The point of the candidate count: it is the larger population.
        // If it ever collapses to the stacking-context count, the probe is
        // measuring the same thing twice and explains nothing.
        expect(
          seededLayers.renderLayerCandidates,
          "candidates should exceed stacking contexts — that gap is the hypothesis",
        ).toBeGreaterThan(seededLayers.stackingContexts);
      } finally {
        await app.quitGracefully();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
