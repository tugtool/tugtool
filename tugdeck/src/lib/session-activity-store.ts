/**
 * `SessionActivityStore` — the app-scoped, per-session activity model
 * ([P01], Spec S01). One store keyed by `tug_session_id` (mirroring
 * `PulseStore`), holding a per-channel {@link ActivityMeterLike} for each
 * session, fed by one `ACTIVITY` subscription ([P13] wire contract).
 *
 * The store is a **pure consumer** ([P01]–[P04]): the wire frame maps 1:1
 * to `record(session, channel, units, at)`. All derivation lives upstream
 * in tugcode ([Q05]); the deck no longer counts anything off CODE_OUTPUT.
 *
 * **State zones.** The high-churn series live only in the meters, read
 * imperatively on the consumer's timer and painted to SVG ([L02], [L06],
 * [P03]). Only membership (which sessions/channels exist) and `enabled`
 * pass through the `useSyncExternalStore` snapshot — a new session or a
 * session's first sample on a new channel ticks React; individual samples
 * never do.
 *
 * @module lib/session-activity-store
 */

import { useSyncExternalStore } from "react";

import type { TugConnection } from "@/connection";
import { FeedId, parseActivityFrame } from "@/protocol";
import {
  GaugeMeter,
  RateMeter,
  type ActivityMeterLike,
  ACTIVITY_BIN_MS,
  ACTIVITY_WINDOW_BINS,
} from "./activity-meter";
import {
  sparklineCurves,
  type SparklineCurve,
} from "@/components/tugways/tug-sparkline";

/** The per-session activity channels (Spec S01). Rate channels are
 *  stream-derived by tugcode; gauge channels are cast-sampled OS signals. */
export type ActivityChannel =
  | "text"
  | "tokens"
  | "tools"
  | "subagents"
  | "cpu"
  | "memory"
  | "disk";

/** Presentation + aggregation metadata for one channel (Spec S01, [P02]). */
export interface ActivityChannelDescriptor {
  /** Human unit for the expanded card's raw readout. */
  unit: string;
  /** CSS color reference — a theme token (hue added per theme in Step 10). */
  hue: string;
  /** Characteristic full-scale for the response curve. */
  fullScale: number;
  /** Vertical response curve. */
  curve: SparklineCurve;
  /** `rate` sums the rolling window; `gauge` sample-and-holds a level. */
  kind: "rate" | "gauge";
}

/**
 * The canonical channel order (composite / dominant iterate rate channels
 * in this order) and their descriptors. Hue tokens resolve to a theme
 * variable; the compact strip picks the dominant channel's hue ([P05]).
 */
export const ACTIVITY_DESCRIPTORS: Readonly<
  Record<ActivityChannel, ActivityChannelDescriptor>
> = Object.freeze({
  text: {
    unit: "chars/s",
    hue: "var(--activity-text)",
    fullScale: 1200,
    curve: sparklineCurves.gamma(0.6),
    kind: "rate",
  },
  tokens: {
    unit: "tok/s",
    hue: "var(--activity-tokens)",
    fullScale: 1200,
    curve: sparklineCurves.gamma(0.6),
    kind: "rate",
  },
  tools: {
    unit: "ops/s",
    hue: "var(--activity-tools)",
    fullScale: 1200,
    curve: sparklineCurves.gamma(0.6),
    kind: "rate",
  },
  subagents: {
    unit: "ops/s",
    hue: "var(--activity-subagents)",
    fullScale: 1200,
    curve: sparklineCurves.gamma(0.6),
    kind: "rate",
  },
  cpu: {
    unit: "%",
    hue: "var(--activity-cpu)",
    fullScale: 100,
    curve: sparklineCurves.linear,
    kind: "gauge",
  },
  memory: {
    unit: "bytes",
    hue: "var(--activity-memory)",
    fullScale: 2 * 1024 * 1024 * 1024,
    curve: sparklineCurves.linear,
    kind: "gauge",
  },
  disk: {
    unit: "B/s",
    hue: "var(--activity-disk)",
    fullScale: 50 * 1024 * 1024,
    curve: sparklineCurves.linear,
    kind: "gauge",
  },
});

/** The rate channels, in canonical order — the compact composite's inputs. */
export const RATE_CHANNELS: readonly ActivityChannel[] = Object.freeze(
  (Object.keys(ACTIVITY_DESCRIPTORS) as ActivityChannel[]).filter(
    (c) => ACTIVITY_DESCRIPTORS[c].kind === "rate",
  ),
);

/** Every known channel, in canonical order. */
export const ALL_CHANNELS: readonly ActivityChannel[] = Object.freeze(
  Object.keys(ACTIVITY_DESCRIPTORS) as ActivityChannel[],
);

const RATE_CHANNEL_SET: ReadonlySet<string> = new Set(RATE_CHANNELS);

/**
 * How many trailing bins the rate window covers (~1s), used by
 * `intensity`/`dominant` to weigh recent contribution. Matches the
 * sparkline's own rolling window so the color and the line agree.
 */
const RATE_WINDOW_BINS = 4;

/** Composite full-scale: the sum of rate contributions that reads as "busy". */
const COMPOSITE_FULL_SCALE = 1200;

/**
 * Dominant-channel hysteresis hold ([P05]). A challenger must out-lead the
 * incumbent continuously for this long before it takes over the color — so a
 * single-sample burst (which decays within the ~1s rate window) never flips
 * the hue, and the compact strip's color doesn't strobe on interleaved work.
 */
const DOMINANT_HOLD_MS = 500;

/** Membership snapshot — the only activity state React observes ([P03]). */
export interface ActivitySnapshot {
  /** Reserved kill switch; always true today (the strip's visibility is
   *  governed by `pulse/enabled`). Kept for API parity with Spec S01. */
  enabled: boolean;
  /** Which channels each session has produced at least one sample on. */
  sessions: ReadonlyMap<string, readonly ActivityChannel[]>;
}

const EMPTY_SNAPSHOT: ActivitySnapshot = Object.freeze({
  enabled: true,
  sessions: new Map<string, readonly ActivityChannel[]>(),
});

function makeMeter(channel: ActivityChannel): ActivityMeterLike {
  return ACTIVITY_DESCRIPTORS[channel].kind === "gauge"
    ? new GaugeMeter()
    : new RateMeter();
}

export class SessionActivityStore {
  private readonly conn: TugConnection | null;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Array<() => void> = [];
  /** session id → channel → meter. */
  private readonly meters = new Map<
    string,
    Map<ActivityChannel, ActivityMeterLike>
  >();
  private snapshot: ActivitySnapshot = EMPTY_SNAPSHOT;
  /** The sticky dominant channel per session ([P05] hysteresis incumbent). */
  private readonly dominantHeld = new Map<string, ActivityChannel>();
  /** A challenger currently out-leading the incumbent, and since when. */
  private readonly dominantPending = new Map<
    string,
    { channel: ActivityChannel; since: number }
  >();

  constructor(conn: TugConnection | null) {
    this.conn = conn;
    if (conn !== null) {
      // One app-scoped subscription to the raw ACTIVITY feed ([P01]).
      // The store routes by the frame's own `tug_session_id`, so it sees
      // every session — unlike the per-card `subscribeSessionFeed`, which
      // filters to one.
      this.disposers.push(conn.onFrame(FeedId.ACTIVITY, (payload) => {
        const frame = parseActivityFrame(payload);
        if (frame === null) return;
        // Bin by receipt time — frames arrive ~real-time (≤250 ms) and
        // tugcode does not stamp a deck-clock timestamp, matching the
        // former local-derivation behavior.
        const at = Date.now();
        for (const [channel, units] of Object.entries(frame.channels)) {
          this.record(
            frame.tug_session_id,
            channel as ActivityChannel,
            units,
            at,
          );
        }
      }));
    }
  }

  dispose(): void {
    for (const fn of this.disposers) fn();
    this.disposers.length = 0;
    this.listeners.clear();
    this.meters.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ActivitySnapshot => this.snapshot;

  /** 1:1 with an `ACTIVITY` frame channel sample ([P15]). */
  record(
    session: string,
    channel: ActivityChannel,
    units: number,
    atMs: number,
  ): void {
    if (session.length === 0) return;
    if (!(channel in ACTIVITY_DESCRIPTORS)) return;
    let channels = this.meters.get(session);
    let membershipChanged = false;
    if (channels === undefined) {
      channels = new Map();
      this.meters.set(session, channels);
      membershipChanged = true;
    }
    let meter = channels.get(channel);
    if (meter === undefined) {
      meter = makeMeter(channel);
      channels.set(channel, meter);
      membershipChanged = true;
    }
    meter.record(units, atMs);
    // Only a new session / new channel ticks React ([P03]); samples don't.
    if (membershipChanged) this.recomputeMembership();
  }

  /** Per-bin window for one channel; empty when the channel is absent. */
  series(session: string, channel: ActivityChannel, nowMs: number): number[] {
    const meter = this.meters.get(session)?.get(channel);
    return meter ? meter.series(nowMs) : [];
  }

  /** Latest held value + unit for a gauge channel; null for absent/rate. */
  raw(
    session: string,
    channel: ActivityChannel,
  ): { value: number; unit: string } | null {
    const meter = this.meters.get(session)?.get(channel);
    if (meter === undefined) return null;
    const value = meter.raw(Date.now());
    if (value === null) return null;
    return { value, unit: ACTIVITY_DESCRIPTORS[channel].unit };
  }

  /** Which channels this session has produced samples on, canonical order. */
  channels(session: string): ActivityChannel[] {
    const channels = this.meters.get(session);
    if (channels === undefined) return [];
    return ALL_CHANNELS.filter((c) => channels.has(c));
  }

  /**
   * Per-bin sum across the session's rate channels — the compact strip's
   * single line ([P04]). Gauges are levels, not work, so they are excluded
   * from the composite (the expanded card shows them per-channel).
   */
  compositeSeries(session: string, nowMs: number): number[] {
    const channels = this.meters.get(session);
    if (channels === undefined) return new Array<number>(ACTIVITY_WINDOW_BINS).fill(0);
    let out: number[] | null = null;
    for (const channel of RATE_CHANNELS) {
      const meter = channels.get(channel);
      if (meter === undefined) continue;
      const s = meter.series(nowMs);
      if (out === null) {
        out = s.slice();
      } else {
        for (let i = 0; i < out.length && i < s.length; i++) out[i] += s[i];
      }
    }
    return out ?? new Array<number>(ACTIVITY_WINDOW_BINS).fill(0);
  }

  /** Composite work over the trailing window as a 0..1 fraction ([P04]). */
  intensity(session: string, nowMs: number): number {
    const series = this.compositeSeries(session, nowMs);
    const sum = trailingSum(series, RATE_WINDOW_BINS);
    return Math.min(1, Math.max(0, sum / COMPOSITE_FULL_SCALE));
  }

  /**
   * The dominant rate channel over the trailing window — the compact strip's
   * hue source ([P04]/[P05]) — with hysteresis so a momentary challenger
   * can't flip the color. The channel with the largest recent contribution
   * takes over only after out-leading the incumbent continuously for
   * {@link DOMINANT_HOLD_MS}; a single-sample burst that decays first never
   * promotes. Returns null when the session is idle.
   *
   * `nowMs` is the clock — the hold is measured against it, so the color
   * loop's own timeline drives the hysteresis (no wall-clock dependency).
   */
  dominant(session: string, nowMs: number): ActivityChannel | null {
    const channels = this.meters.get(session);
    if (channels === undefined) {
      this.dominantHeld.delete(session);
      this.dominantPending.delete(session);
      return null;
    }
    let leader: ActivityChannel | null = null;
    let leaderSum = 0;
    for (const channel of RATE_CHANNELS) {
      const meter = channels.get(channel);
      if (meter === undefined) continue;
      const sum = trailingSum(meter.series(nowMs), RATE_WINDOW_BINS);
      if (sum > leaderSum) {
        leaderSum = sum;
        leader = channel;
      }
    }
    if (leaderSum <= 0 || leader === null) {
      this.dominantHeld.delete(session);
      this.dominantPending.delete(session);
      return null;
    }
    const held = this.dominantHeld.get(session);
    if (held === undefined || !channels.has(held)) {
      // No incumbent (or it vanished) — adopt the current leader outright.
      this.dominantHeld.set(session, leader);
      this.dominantPending.delete(session);
      return leader;
    }
    if (leader === held) {
      // Incumbent still leads — reset any pending challenger.
      this.dominantPending.delete(session);
      return held;
    }
    // A challenger leads: it must sustain the lead for the hold window.
    const pending = this.dominantPending.get(session);
    if (pending === undefined || pending.channel !== leader) {
      this.dominantPending.set(session, { channel: leader, since: nowMs });
      return held;
    }
    if (nowMs - pending.since >= DOMINANT_HOLD_MS) {
      this.dominantHeld.set(session, leader);
      this.dominantPending.delete(session);
      return leader;
    }
    return held;
  }

  /** Drop a closed session's meters + membership. */
  clearSession(session: string): void {
    if (!this.meters.has(session)) return;
    this.meters.delete(session);
    this.dominantHeld.delete(session);
    this.dominantPending.delete(session);
    this.recomputeMembership();
  }

  private recomputeMembership(): void {
    const sessions = new Map<string, readonly ActivityChannel[]>();
    for (const [session] of this.meters) {
      sessions.set(session, this.channels(session));
    }
    this.snapshot = Object.freeze({ enabled: this.snapshot.enabled, sessions });
    for (const listener of [...this.listeners]) listener();
  }
}

/** Sum the trailing `count` values of a series (its most recent bins). */
function trailingSum(series: number[], count: number): number {
  let sum = 0;
  for (let i = Math.max(0, series.length - count); i < series.length; i++) {
    sum += series[i];
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Singleton + hook (mirrors PulseStore)
// ---------------------------------------------------------------------------

let _activeStore: SessionActivityStore | null = null;

export function attachSessionActivityStore(
  conn: TugConnection,
): SessionActivityStore {
  if (_activeStore !== null) return _activeStore;
  _activeStore = new SessionActivityStore(conn);
  return _activeStore;
}

export function getSessionActivityStore(): SessionActivityStore | null {
  return _activeStore;
}

/** Test-only: detach the singleton between cases. */
export function _resetSessionActivityStoreForTest(): void {
  _activeStore?.dispose();
  _activeStore = null;
}

/** The compact bin width, re-exported so the strip reads one source. */
export { ACTIVITY_BIN_MS };

/**
 * React hook: the activity membership snapshot. Returns the empty snapshot
 * when no store is attached (gallery / fixtures).
 */
export function useSessionActivity(): ActivitySnapshot {
  return useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => _activeStore?.getSnapshot() ?? EMPTY_SNAPSHOT,
    () => EMPTY_SNAPSHOT,
  );
}
