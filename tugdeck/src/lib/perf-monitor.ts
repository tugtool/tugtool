/**
 * perf-monitor — dev/test-build main-thread health sentinel.
 *
 * Watches for the two symptoms every perf regression in the deck
 * eventually shows: LONG TASKS (main-thread stalls a keystroke or a
 * frame would queue behind) and MISSED IDLE (work happening when the
 * app should be doing nothing). Findings land in two places:
 *
 *  - counters, readable via {@link getPerfMonitorSnapshot} (stable
 *    reference between changes, [L02]-shaped for a future DevPanel
 *    Telemetry tile and for app-tests via `window.tugPerfMonitor`);
 *  - the dev log (`tugDevLogStore`, source `"perf"`) — one entry per
 *    stall at `warn` for ≥{@link STALL_WARN_MS}, `debug` below it — so
 *    the Log section timeline correlates stalls with whatever else was
 *    happening.
 *
 * Detection is two-pronged:
 *
 *  1. A `PerformanceObserver` on `longtask` entries where the engine
 *     supports them (feature-detected via `supportedEntryTypes`).
 *  2. A 1 Hz heartbeat that measures timer drift: a `setTimeout(1000)`
 *     that fires at +1240ms implies ~240ms of continuous main-thread
 *     occupancy. This is deliberately coarse — it exists because WebKit
 *     has not historically exposed `longtask` — and its threshold
 *     ({@link DRIFT_STALL_MS}) sits above scheduler jitter.
 *
 * The monitor runs ONLY in dev builds and app-test mode
 * (`window.__tugTestMode`): a production deck must not carry a
 * perpetual 1 Hz wakeup — the idle-zero-burn budget below applies to
 * the product, and the monitor must never violate the thing it guards.
 *
 * ## Budgets (the no-perceivable-lag contract)
 *
 *  - IDLE: with sessions mounted and nothing streaming, the main
 *    thread does no long tasks — zero stalls per idle minute (pinned
 *    by app-test at0230's idle-quiet window).
 *  - INPUT: a keystroke's synchronous work fits in one display frame
 *    (≤16ms) even while other cards stream.
 *  - STREAMING: React notification cadence per store is bounded by
 *    LIVE_NOTIFY_MIN_MS (~one frame), never per-token.
 *
 * @module lib/perf-monitor
 */

import { tugDevLogStore } from "./tug-dev-log-store/tug-dev-log-store";

/** Heartbeat period — also the drift-measurement baseline. */
const HEARTBEAT_MS = 1_000;
/** Drift below this is scheduler jitter, not a stall. */
const DRIFT_STALL_MS = 80;
/** Stalls at/above this log at `warn`; below, `debug`. */
const STALL_WARN_MS = 150;

export interface PerfMonitorSnapshot {
  /** `longtask` entries observed (0 forever when unsupported). */
  longTasks: number;
  /** Longest single `longtask`, ms. */
  worstLongTaskMs: number;
  /** Heartbeat drift stalls (≥ {@link DRIFT_STALL_MS}). */
  driftStalls: number;
  /** Worst heartbeat drift, ms. */
  worstDriftMs: number;
  /** Whether the engine exposes `longtask` entries. */
  longTaskSupported: boolean;
  /** ms since the monitor started. */
  uptimeMs: number;
}

let snapshot: PerfMonitorSnapshot = {
  longTasks: 0,
  worstLongTaskMs: 0,
  driftStalls: 0,
  worstDriftMs: 0,
  longTaskSupported: false,
  uptimeMs: 0,
};
let startedAt = 0;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let observer: PerformanceObserver | null = null;

/** Current counters. Fresh object per call is fine here — the reader is
 *  a probe (an app-test, a DevPanel tile pulling on its own cadence),
 *  not a `useSyncExternalStore` subscriber. */
export function getPerfMonitorSnapshot(): PerfMonitorSnapshot {
  return {
    ...snapshot,
    uptimeMs: startedAt === 0 ? 0 : performance.now() - startedAt,
  };
}

function recordStall(kind: "longtask" | "drift", ms: number): void {
  const level = ms >= STALL_WARN_MS ? "warn" : "debug";
  tugDevLogStore[level]("perf", `main-thread stall (${kind})`, {
    ms: Math.round(ms),
  });
}

/**
 * Start the monitor. Idempotent; safe to call from boot. The caller
 * gates on dev/test mode — see the module docstring for why production
 * never runs this.
 */
export function startPerfMonitor(): void {
  if (startedAt !== 0) return;
  startedAt = performance.now();

  const supported =
    typeof PerformanceObserver !== "undefined" &&
    (PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false);
  snapshot = { ...snapshot, longTaskSupported: supported };
  if (supported) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        snapshot = {
          ...snapshot,
          longTasks: snapshot.longTasks + 1,
          worstLongTaskMs: Math.max(snapshot.worstLongTaskMs, entry.duration),
        };
        recordStall("longtask", entry.duration);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  }

  let expectedAt = performance.now() + HEARTBEAT_MS;
  const beat = (): void => {
    const drift = performance.now() - expectedAt;
    if (drift >= DRIFT_STALL_MS) {
      snapshot = {
        ...snapshot,
        driftStalls: snapshot.driftStalls + 1,
        worstDriftMs: Math.max(snapshot.worstDriftMs, drift),
      };
      recordStall("drift", drift);
    }
    expectedAt = performance.now() + HEARTBEAT_MS;
    heartbeatTimer = setTimeout(beat, HEARTBEAT_MS);
  };
  heartbeatTimer = setTimeout(beat, HEARTBEAT_MS);
}

/** Stop and reset — test hygiene. */
export function stopPerfMonitor(): void {
  if (heartbeatTimer !== null) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
  observer?.disconnect();
  observer = null;
  startedAt = 0;
  snapshot = {
    longTasks: 0,
    worstLongTaskMs: 0,
    driftStalls: 0,
    worstDriftMs: 0,
    longTaskSupported: false,
    uptimeMs: 0,
  };
}
