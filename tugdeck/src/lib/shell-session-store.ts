/**
 * `ShellSessionStore` — the per-card `$`-route shell session ([P12]).
 *
 * Owns the shell **session** state (`live`, `cwd`, and the in-flight exchange
 * that drives the route-aware submit button, [P13]) and is the SOLE consumer
 * of the card's `SHELL_OUTPUT` feed. It does NOT own the exchange rows: each
 * exchange's transcript presence lives in `CodeSessionStore`, which this store
 * feeds through `ingestShellExchange` on `exchange_started` (mint an in-flight
 * shell turn) and `exchange_complete` (settle it) — one consumer chain, no
 * dual-ingest race ([P12]). `SHELL_OUTPUT` is deliberately absent from the
 * code-session feed filter, so shell frames reach only this store.
 *
 * The [L02] store surface (`subscribe` / `getSnapshot`) drives the cwd chip
 * and the route-aware Z5. Session-scoped: the feed is filtered to this card's
 * `tug_session_id`, and `exec` / `kill` stamp it on the outbound frame.
 *
 * `/clear` reset is implicit: a `/clear` fresh-spawns a new `tug_session_id`,
 * so `cardServicesStore` disposes this store and constructs a fresh one — the
 * in-memory session state resets with the swap (the ledger, keyed by session,
 * is untouched).
 */

import { FeedId, type FeedIdValue } from "../protocol";
import type { FeedStore } from "./feed-store";
import { getConnection } from "./connection-singleton";
import type { CodeSessionStore } from "./code-session-store";

/** A running exchange — drives the `stop` pose on the `$` route ([P13]). */
export interface ShellInflight {
  exchangeId: string;
  command: string;
}

export interface ShellSessionSnapshot {
  /** Whether a shell child is live for this session. */
  live: boolean;
  /** The shell's working directory; `null` before the first spawn. */
  cwd: string | null;
  /** The in-flight exchange, or `null` when idle. */
  inflight: ShellInflight | null;
  /**
   * A share gesture waiting for the prompt entry to consume ([P08]).
   * The Share affordance on an exchange row composes the fenced
   * command/output text and parks it here; the prompt entry observes
   * the slot, flips the route to `❯`, seeds the editor, and calls
   * `consumePendingShare`. Never auto-sent — the user edits and sends.
   */
  pendingShare: { text: string } | null;
}

const EMPTY_SNAPSHOT: ShellSessionSnapshot = {
  live: false,
  cwd: null,
  inflight: null,
  pendingShare: null,
};

export class ShellSessionStore {
  private _snapshot: ShellSessionSnapshot = EMPTY_SNAPSHOT;
  private _listeners = new Set<() => void>();
  private _unsubscribeFeed: (() => void) | null = null;
  private _lastPayloadRef: unknown = undefined;
  private _seq = 0;
  private readonly _feedStore: FeedStore;
  private readonly _feedId: FeedIdValue;
  private readonly _tugSessionId: string;
  private readonly _projectDir: string;
  private readonly _codeSessionStore: CodeSessionStore;

  constructor(
    feedStore: FeedStore,
    feedId: FeedIdValue,
    tugSessionId: string,
    projectDir: string,
    codeSessionStore: CodeSessionStore,
  ) {
    this._feedStore = feedStore;
    this._feedId = feedId;
    this._tugSessionId = tugSessionId;
    this._projectDir = projectDir;
    this._codeSessionStore = codeSessionStore;
    // Seed cwd optimistically to the project dir so the chip reads something
    // before the first `shell_state` frame lands.
    this._snapshot = { ...EMPTY_SNAPSHOT, cwd: projectDir };
    this._unsubscribeFeed = feedStore.subscribe(() => this._onFeedUpdate());
    // Restore ([P07]): fetch this session's ledgered exchanges and interleave
    // them into the transcript. Sent once at construction — HMR preserves the
    // store, so it never re-fires; a Developer ▸ Reload / relaunch builds a
    // fresh store and re-fetches, which is idempotent (upsert by turnKey). The
    // `list_shell_exchanges_ok` response routes back through action-dispatch to
    // `applyRestoredShellExchanges`.
    getConnection()?.send(
      FeedId.CONTROL,
      new TextEncoder().encode(
        JSON.stringify({ action: "list_shell_exchanges", tug_session_id: tugSessionId }),
      ),
    );
  }

  private _onFeedUpdate(): void {
    const payload = this._feedStore.getSnapshot().get(this._feedId);
    if (payload === this._lastPayloadRef) return;
    this._lastPayloadRef = payload;
    this._fold(payload);
  }

  /** Fold one `SHELL_OUTPUT` frame: update session state and mirror the
   *  exchange lifecycle into `CodeSessionStore`. */
  private _fold(payload: unknown): void {
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as Record<string, unknown>;
    switch (p.type) {
      case "shell_state": {
        const live = p.live === true;
        const cwd = typeof p.cwd === "string" ? p.cwd : this._snapshot.cwd;
        this._set({ ...this._snapshot, live, cwd });
        break;
      }
      case "exchange_started": {
        const cwd = typeof p.cwd === "string" ? p.cwd : this._snapshot.cwd;
        this._set({ ...this._snapshot, live: true, cwd });
        this._codeSessionStore.ingestShellExchange({
          phase: "started",
          exchangeId: String(p.exchange_id ?? ""),
          command: String(p.command ?? ""),
          cwd: typeof p.cwd === "string" ? p.cwd : this._projectDir,
          startedAtMs: numberOr(p.started_at, Date.now()),
        });
        break;
      }
      case "exchange_complete": {
        const exchangeId = String(p.exchange_id ?? "");
        const cwdAfter = typeof p.cwd_after === "string" ? p.cwd_after : null;
        // Clear the in-flight slot if this settles the running exchange.
        const inflight =
          this._snapshot.inflight?.exchangeId === exchangeId
            ? null
            : this._snapshot.inflight;
        this._set({
          ...this._snapshot,
          cwd: cwdAfter ?? this._snapshot.cwd,
          inflight,
        });
        const startedAt = numberOr(p.started_at, Date.now());
        this._codeSessionStore.ingestShellExchange({
          phase: "complete",
          exchangeId,
          command: String(p.command ?? ""),
          output: typeof p.output === "string" ? p.output : "",
          exitCode: typeof p.exit_code === "number" ? p.exit_code : null,
          cwd: typeof p.cwd === "string" ? p.cwd : (cwdAfter ?? this._projectDir),
          cwdAfter,
          startedAtMs: startedAt,
          settledAtMs: numberOr(p.settled_at, startedAt),
        });
        break;
      }
      default:
        break;
    }
  }

  /**
   * Run a command on the `$` route. Mints an `exchange_id`, marks the session
   * in-flight (drives the `stop` pose, [P13]), and sends the `exec` verb on
   * `SHELL_INPUT`. The transcript row is minted when the `exchange_started`
   * frame echoes back — not optimistically — so a failed send never leaves a
   * ghost row. Serial: refused while an exchange is in flight.
   */
  exec(command: string): void {
    const trimmed = command.trim();
    if (trimmed.length === 0) return;
    if (this._snapshot.inflight !== null) return;
    this._seq += 1;
    const exchangeId = `sh-${this._seq}`;
    this._set({ ...this._snapshot, inflight: { exchangeId, command: trimmed } });
    const conn = getConnection();
    if (!conn) {
      // No transport — drop the in-flight marker; nothing was sent.
      this._set({ ...this._snapshot, inflight: null });
      return;
    }
    conn.send(
      FeedId.SHELL_INPUT,
      new TextEncoder().encode(
        JSON.stringify({
          type: "exec",
          tug_session_id: this._tugSessionId,
          exchange_id: exchangeId,
          command: trimmed,
          cwd: this._snapshot.cwd ?? this._projectDir,
        }),
      ),
    );
  }

  /**
   * Park a composed share text for the prompt entry to consume ([P08]).
   * A second share before the first is consumed overwrites it — the
   * newest gesture wins.
   */
  requestShare(text: string): void {
    this._set({ ...this._snapshot, pendingShare: { text } });
  }

  /**
   * Clear the pending share after the prompt entry applies it.
   * Idempotent — a call while the slot is already `null` is a
   * ref-stable no-op and produces no listener notification.
   */
  consumePendingShare(): void {
    if (this._snapshot.pendingShare === null) return;
    this._set({ ...this._snapshot, pendingShare: null });
  }

  /** Kill the running command — reaps the shell's process group ([Q03]). */
  kill(): void {
    const conn = getConnection();
    if (!conn) return;
    conn.send(
      FeedId.SHELL_INPUT,
      new TextEncoder().encode(
        JSON.stringify({ type: "kill", tug_session_id: this._tugSessionId }),
      ),
    );
  }

  private _set(next: ShellSessionSnapshot): void {
    this._snapshot = next;
    for (const listener of this._listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getSnapshot = (): ShellSessionSnapshot => this._snapshot;

  dispose(): void {
    this._unsubscribeFeed?.();
    this._unsubscribeFeed = null;
    this._listeners.clear();
  }

  /** Test seam: fold a raw `SHELL_OUTPUT` payload as if it arrived on the feed. */
  _ingestForTest(payload: unknown): void {
    this._fold(payload);
  }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Apply a `list_shell_exchanges_ok` response ([P07]): mint each ledgered
 * exchange into the transcript through the `ingestShellExchange` bare-complete
 * path, which upserts by `turnKey` at its timestamp position — so restored
 * shell rows interleave among the JSONL-replayed Claude turns, and a re-fetch
 * (reload) is idempotent. The ledger row carries no live `exchange_id` (it was
 * never persisted), so the sqlite row `id` keys a stable `restored-<id>`
 * turn. Pure over the store; exported for the action-dispatch handler + tests.
 */
export function applyRestoredShellExchanges(
  codeSessionStore: CodeSessionStore,
  rows: ReadonlyArray<Record<string, unknown>>,
): void {
  for (const r of rows) {
    const started = numberOr(r.started_at_ms, 0);
    codeSessionStore.ingestShellExchange({
      phase: "complete",
      exchangeId: `restored-${r.id}`,
      command: String(r.command ?? ""),
      output: typeof r.output === "string" ? r.output : "",
      exitCode: typeof r.exit_code === "number" ? r.exit_code : null,
      cwd: typeof r.cwd === "string" ? r.cwd : "",
      cwdAfter: typeof r.cwd_after === "string" ? r.cwd_after : null,
      startedAtMs: started,
      settledAtMs: numberOr(r.settled_at_ms, started),
    });
  }
}
