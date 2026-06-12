/**
 * at0185-corpus-baseline.test.ts — resume baseline + reveal-chain
 * audit over the REAL session corpus.
 *
 * For every snapshot the harvester selected (`corpus/manifest.json`),
 * seeds it into `~/.claude/projects/` under a temp project dir (cwd
 * rewritten per record), resumes it through the real picker → spawn →
 * tugcode → JSONL-replay pipeline, and records:
 *
 *   - the per-resume waterfall (list latency, ingest folds/commits,
 *     row-parse counters) via `window.__tug.getSessionPerf`, and
 *   - the REVEAL CHAIN, sampled from the harness in a tight RPC loop:
 *     when the `DevRestoring` placeholder is visible, when the
 *     transcript host first exists, when the first user row mounts,
 *     when the [DT10] `data-replaying` gate drops — plus every
 *     main-thread stall (a sampling gap: a frozen page cannot answer
 *     the next `evalJS`, so the gap IS the freeze, measured).
 *
 * Prints `CORPUS ...` lines for the plan's baseline tables. Asserts
 * only structural sanity; per-class budget gates harden in the plan
 * and land with the optimization steps.
 *
 * Gating: skips without `TUGAPP_APP_TEST=1` or a harvested corpus.
 * Whale-class legs additionally require `TUGAPP_CORPUS_WHALE=1` — a
 * saturated WebView can defeat the harness's own RPC timeouts, so the
 * default sweep never runs them (their numbers are recorded in the
 * plan).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  loadManifest,
  seedSnapshot,
  type SelectedSnapshot,
} from "./corpus/resolve";
import {
  auditReveal,
  budgetsFor,
  openSeededSession,
  USER_ROWS,
  type PerfRead,
} from "./corpus/runner";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const RUN_WHALE = process.env.TUGAPP_CORPUS_WHALE === "1";

async function resumeAndAudit(snap: SelectedSnapshot): Promise<void> {
  const budgets = budgetsFor(snap);
  const label = `${snap.class}-${snap.primaryShape}`;
  const seeded = await seedSnapshot(snap, label);
  try {
    const app = await launchTugApp({ testName: `at0185-${label}` });
    try {
      const { listMs, openedAt, listed } = await openSeededSession(
        app,
        seeded,
        budgets,
      );
      if (!listed) {
        console.log(
          `CORPUS ${snap.id.slice(0, 8)} class=${snap.class} shape=${snap.primaryShape} ` +
            `bytes=${snap.bytes} turns=${snap.stats.turns} DID NOT LIST in ${listMs}ms`,
        );
        return;
      }
      const reveal = await auditReveal(app, openedAt, budgets.settleTimeoutMs);

      let perf: PerfRead | null = null;
      let rows = 0;
      try {
        perf = await app.evalJS<PerfRead>(`window.__tug.getSessionPerf("A")`, {
          timeoutMs: 30_000,
        });
        rows = await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length`,
        );
      } catch {
        // A page this wedged records as perf=null.
      }

      console.log(
        `CORPUS ${snap.id.slice(0, 8)} class=${snap.class} shape=${snap.primaryShape} ` +
          `bytes=${snap.bytes} turns=${snap.stats.turns} ` +
          `blocks=${JSON.stringify(snap.stats.blocks)} ` +
          `listMs=${listMs} settledMs=${reveal.settledMs} rows=${rows} ` +
          `ingest=${JSON.stringify(perf?.lastReplay ?? perf?.replay ?? null)} ` +
          `rowParse=${JSON.stringify(perf?.rowParse ?? null)} ` +
          `reveal=${JSON.stringify({ ...reveal, samples: undefined })} ` +
          `samples=${reveal.samples}`,
      );

      if (!budgets.tolerateIncomplete) {
        expect(reveal.settledMs).not.toBeNull();
        expect(perf).not.toBeNull();
        expect(perf!.lastReplay).not.toBeNull();
        expect(perf!.lastReplay!.frames).toBeGreaterThan(0);
        expect(rows).toBeGreaterThan(0);
        // Feedback criterion: between Open and settled the card always
        // shows something honest — placeholder, progress strip, or
        // content. Mount-transition flicker tolerance only.
        expect(reveal.maxBlankRunMs).toBeLessThanOrEqual(500);
      }
    } finally {
      await app.close();
    }
  } finally {
    seeded.cleanup();
  }
}

const manifest = SHOULD_RUN ? loadManifest() : null;
const snapshots = (manifest?.selected ?? []).filter(
  (s) => s.class !== "whale" || RUN_WHALE,
);

describe.skipIf(!SHOULD_RUN || manifest === null)(
  "AT0185: corpus resume baseline + reveal audit",
  () => {
    if (snapshots.length === 0) {
      test.skip("no corpus snapshots available", () => {});
      return;
    }
    for (const snap of snapshots) {
      test(
        `${snap.class}/${snap.primaryShape} ${snap.id.slice(0, 8)} records its waterfall`,
        async () => {
          await resumeAndAudit(snap);
        },
        snap.class === "whale" ? 600_000 : 360_000,
      );
    }
  },
);
