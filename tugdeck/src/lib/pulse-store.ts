/**
 * `PulseStore` — app-scoped snapshot cache for PULSE commentary lines.
 *
 * Hydrates from tugcast's capped pulse ledger on first observation
 * (one `list_pulse_lines` CONTROL round-trip — the
 * `session-state-changes-reader` pattern), then folds live `PULSE`
 * feed frames as the commentator speaks. The snapshot also carries
 * the `pulse/enabled` tugbank default so the strip's
 * hidden-when-disabled state flows from the store, not an ad-hoc
 * fetch.
 *
 * **Laws.** [L02] — external state (wire frames, CONTROL responses,
 * the tugbank toggle) enters React only through `useSyncExternalStore`
 * via {@link usePulse}; snapshots are referentially stable between
 * folds. No persistence here beyond the server's ledger — the deck
 * never caches pulse lines locally.
 */

import { useSyncExternalStore } from "react";

import type { TugConnection } from "@/connection";
import {
  FeedId,
  encodeListPulseLines,
  parsePulseFrame,
  type ListPulseLinesOk,
} from "@/protocol";
import { getTugbankClient } from "@/lib/tugbank-singleton";

/** Mirror of tugcast's tail length — the rolling display cap. */
export const PULSE_LINES_CAP = 20;

/** Tugbank default holding the kill switch (bool; absent = enabled). */
export const PULSE_ENABLED_DOMAIN = "dev.tugtool.pulse";
export const PULSE_ENABLED_KEY = "enabled";

/** One displayable pulse line. `key` is stable line identity (the
 * strip's fade-in animation keys on it). */
export interface PulseLineEntry {
  key: string;
  text: string;
  /** Retained high-level thought behind a low-level `text` beat —
   *  the strip renders "intent • text" when present. */
  intent?: string;
  scopes: readonly string[];
  beat: number;
  atMs: number;
}

export interface PulseSnapshot {
  /** The `pulse/enabled` toggle; the strip hides entirely when false. */
  enabled: boolean;
  /** Ledger-tail load state; live folds work in any state. */
  status: "idle" | "pending" | "ready";
  /** Rolling log, oldest-first, capped at {@link PULSE_LINES_CAP}. */
  lines: readonly PulseLineEntry[];
  /** Convenience: newest line app-wide, or null before the first. */
  latest: PulseLineEntry | null;
  /**
   * Per-scope cleared watermarks: submitting a new message clears
   * that card's strip, so `cleared.get(scope)` holds the line keys
   * that existed at submit time — the selector skips them; lines
   * arriving afterwards show normally.
   */
  cleared: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The newest line about `scope` — a card's strip shows commentary
 * about ITS session, never another card's. A line whose `scopes`
 * include the literal `"app"` (or carry no scopes at all) is
 * app-wide ambience and shows everywhere; a multi-scope line shows
 * on every card it covers — that's the cross-session weave working,
 * not a leak.
 */
export function latestLineForScope(
  lines: readonly PulseLineEntry[],
  scope: string,
  clearedKeys?: ReadonlySet<string>,
): PulseLineEntry | null {
  if (scope.length === 0) return null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (clearedKeys?.has(line.key) === true) continue;
    if (
      line.scopes.length === 0 ||
      line.scopes.includes(scope) ||
      line.scopes.includes("app")
    ) {
      return line;
    }
  }
  return null;
}

/**
 * The newest `limit` lines about `scope`, newest-first — the strip's history
 * popover. Same scope rule as {@link latestLineForScope} (the session's own
 * lines plus `app`-wide / unscoped ambience); cleared watermarks are NOT
 * applied, since the history shows what actually happened.
 */
export function linesForScope(
  lines: readonly PulseLineEntry[],
  scope: string,
  limit: number,
): PulseLineEntry[] {
  const out: PulseLineEntry[] = [];
  if (scope.length === 0) return out;
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i];
    if (
      line.scopes.length === 0 ||
      line.scopes.includes(scope) ||
      line.scopes.includes("app")
    ) {
      out.push(line);
    }
  }
  return out;
}

const EMPTY_LINES: readonly PulseLineEntry[] = Object.freeze([]);
const EMPTY_CLEARED: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const IDLE_SNAPSHOT: PulseSnapshot = Object.freeze({
  enabled: true,
  status: "idle",
  lines: EMPTY_LINES,
  latest: null,
  cleared: EMPTY_CLEARED,
});

// ---------------------------------------------------------------------------
// CONTROL response bus — action-dispatch publishes, the store consumes.
// ---------------------------------------------------------------------------

type OkListener = (payload: ListPulseLinesOk) => void;
const okListeners = new Set<OkListener>();

/** Called by `action-dispatch.ts` when `list_pulse_lines_ok` lands. */
export function publishListPulseLinesOk(payload: ListPulseLinesOk): void {
  for (const listener of [...okListeners]) listener(payload);
}

function subscribeToListPulseLinesOk(listener: OkListener): () => void {
  okListeners.add(listener);
  return () => okListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

function lineKey(atMs: number, beat: number): string {
  return `${atMs}:${beat}`;
}

export class PulseStore {
  private readonly conn: TugConnection;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Array<() => void> = [];
  private snapshot: PulseSnapshot = IDLE_SNAPSHOT;
  private tailRequested = false;

  constructor(conn: TugConnection) {
    this.conn = conn;
    // Live lines fold as the commentator speaks — including while the
    // tail load is still pending (the merge dedupes by line identity).
    this.conn.onFrame(FeedId.PULSE, (payload) => {
      const line = parsePulseFrame(payload);
      if (line === null) return;
      this.fold([
        {
          key: lineKey(line.at, line.beat),
          text: line.text,
          ...(line.intent !== undefined ? { intent: line.intent } : {}),
          scopes: Object.freeze([...line.scopes]),
          beat: line.beat,
          atMs: line.at,
        },
      ]);
    });
    this.disposers.push(
      subscribeToListPulseLinesOk((payload) => this.onTail(payload)),
    );
    // The enabled toggle rides the tugbank cache; a DEFAULTS push for
    // the pulse domain re-derives the snapshot.
    const client = getTugbankClient();
    if (client) {
      this.disposers.push(
        client.onDomainChanged((domain) => {
          if (domain !== PULSE_ENABLED_DOMAIN) return;
          this.snapshot = Object.freeze({
            ...this.snapshot,
            enabled: readEnabled(),
          });
          this.tick();
        }),
      );
    }
  }

  dispose(): void {
    for (const fn of this.disposers) fn();
    this.disposers.length = 0;
    this.listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * A new message was submitted for `scope`: everything currently on
   * the log is "before" for that card — its strip clears until the
   * next line arrives. Called by `CodeSessionStore.send`.
   */
  clearScope(scope: string): void {
    if (scope.length === 0) return;
    const keys = new Set(this.snapshot.lines.map((l) => l.key));
    const cleared = new Map(this.snapshot.cleared);
    cleared.set(scope, keys);
    this.snapshot = Object.freeze({ ...this.snapshot, cleared });
    this.tick();
  }

  /**
   * Current snapshot. The first call kicks the one-shot ledger-tail
   * CONTROL request; live folds keep working regardless of its fate.
   */
  getSnapshot = (): PulseSnapshot => {
    if (!this.tailRequested) {
      this.tailRequested = true;
      this.snapshot = Object.freeze({
        ...this.snapshot,
        status: "pending" as const,
        enabled: readEnabled(),
      });
      const frame = encodeListPulseLines();
      this.conn.send(frame.feedId, frame.payload);
    }
    return this.snapshot;
  };

  private onTail(payload: ListPulseLinesOk): void {
    const tail: PulseLineEntry[] = payload.lines.map((row) =>
      Object.freeze({
        key: lineKey(row.at_ms, row.beat),
        text: row.text,
        ...(typeof row.intent === "string" && row.intent.length > 0
          ? { intent: row.intent }
          : {}),
        scopes: Object.freeze([...row.scopes]) as readonly string[],
        beat: row.beat,
        atMs: row.at_ms,
      }),
    );
    // Tail (history) first, then any live lines that landed while the
    // load was in flight; dedupe on line identity.
    const live = this.snapshot.lines;
    const seen = new Set(tail.map((l) => l.key));
    const merged = [...tail];
    for (const line of live) {
      if (seen.has(line.key)) continue;
      seen.add(line.key);
      merged.push(line);
    }
    this.commit(merged, "ready");
  }

  private fold(incoming: PulseLineEntry[]): void {
    const seen = new Set(this.snapshot.lines.map((l) => l.key));
    const fresh = incoming.filter((l) => !seen.has(l.key));
    if (fresh.length === 0) return;
    this.commit([...this.snapshot.lines, ...fresh], this.snapshot.status);
  }

  private commit(
    lines: PulseLineEntry[],
    status: PulseSnapshot["status"],
  ): void {
    const capped =
      lines.length > PULSE_LINES_CAP ? lines.slice(-PULSE_LINES_CAP) : lines;
    this.snapshot = Object.freeze({
      enabled: this.snapshot.enabled,
      status,
      lines: Object.freeze(capped) as readonly PulseLineEntry[],
      latest: capped.length > 0 ? capped[capped.length - 1] : null,
      cleared: this.snapshot.cleared,
    });
    this.tick();
  }

  private tick(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** The `pulse/enabled` tugbank default; absent reads as enabled. */
function readEnabled(): boolean {
  const client = getTugbankClient();
  if (!client) return true;
  const entry = client.get(PULSE_ENABLED_DOMAIN, PULSE_ENABLED_KEY);
  if (entry === undefined) return true;
  return entry.value !== false;
}

// ---------------------------------------------------------------------------
// Singleton + hook
// ---------------------------------------------------------------------------

let _activeStore: PulseStore | null = null;

export function attachPulseStore(conn: TugConnection): PulseStore {
  if (_activeStore !== null) return _activeStore;
  _activeStore = new PulseStore(conn);
  return _activeStore;
}

export function getPulseStore(): PulseStore | null {
  return _activeStore;
}

/** Test-only: detach the singleton between cases. */
export function _resetPulseStoreForTest(): void {
  _activeStore?.dispose();
  _activeStore = null;
}

/**
 * React hook: the app-wide pulse snapshot. Returns the idle snapshot
 * when no store is attached (gallery / fixtures).
 */
export function usePulse(): PulseSnapshot {
  return useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => _activeStore?.getSnapshot() ?? IDLE_SNAPSHOT,
    () => IDLE_SNAPSHOT,
  );
}

/**
 * React hook: just the `pulse/enabled` toggle. A narrow selector (boolean,
 * no identity churn) so a subscriber re-renders only when the kill switch
 * flips, not on every new line — the dev card reads this to decide whether
 * the PULSE strip occupies a row in its keyboard-focus cycle.
 */
export function usePulseEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => _activeStore?.getSnapshot().enabled ?? IDLE_SNAPSHOT.enabled,
    () => IDLE_SNAPSHOT.enabled,
  );
}
