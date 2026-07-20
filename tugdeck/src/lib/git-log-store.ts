/**
 * GitLogStore — a single shared, request-correlated store for the Git History
 * Lens section, over the GIT_LOG feeds.
 *
 * Git History shows one project at a time (the followed session card's), so unlike
 * the per-entry `GitDiffStore` fan-out this is one module-level store over one
 * shared `FeedStore(conn, [GIT_LOG])`. `requestLog(projectDir)` sends a
 * `GIT_LOG_QUERY` (0x26) carrying the project dir as `root` plus a correlating
 * `requestId`; tugcast answers with a single `GIT_LOG` (0x25) frame. The
 * response is a broadcast every client sees, so correlation is entirely
 * client-side: the `gl-<storeId>-<seq>` id is what keeps stores from crossing
 * wires, and only the response whose `request_id` matches the in-flight request
 * is accepted.
 *
 * A requested-key guard makes `requestLog` idempotent — re-renders and collapse
 * toggles can call it freely; a fresh query fires only when the project changes
 * or the last request errored. `refresh()` re-requests the current root
 * unconditionally (mount-time request + future affordances).
 *
 * `formatGitLog` (the section's text presentation) lives here too so it is
 * unit-testable without React or a live connection.
 *
 * Laws: [L02] consumers read the store via `useSyncExternalStore`.
 *
 * @module lib/git-log-store
 */

import { FeedStore } from "./feed-store";
import { FeedId } from "../protocol";
import { getConnection } from "./connection-singleton";

// ── Wire types (mirror tugcast-core `GitLogSnapshot`) ───────────────────────

/** One commit in a `git log` payload. */
export interface GitLogCommit {
  /** Full 40-char commit hash. Shortened for display. */
  sha: string;
  /** The commit subject line (`%s`). */
  subject: string;
  /** Author name (`%an`). */
  author: string;
  /** Author date, `--date=short` (`YYYY-MM-DD`). */
  date: string;
  /** The `Tug-Dash:` trailer value when the commit landed as a dash join —
   *  drives the History join badge ([P09]). */
  tug_dash?: string;
}

/** A single-shot recent-commits payload from tugcast (GIT_LOG feed). */
export interface GitLogPayload {
  request_id: string;
  workspace_key: string;
  /** Current branch, `"(detached)"` when detached, `""` when `no_repo`. */
  branch: string;
  /** True when the project dir is not inside a git working tree. */
  no_repo: boolean;
  /** Most-recent-first commits. */
  commits: GitLogCommit[];
}

/** Lifecycle of the current/last log request. */
export type GitLogPhase = "idle" | "loading" | "ready" | "error";

/** Reactive snapshot the section renders via `useSyncExternalStore`. */
export interface GitLogStoreSnapshot {
  phase: GitLogPhase;
  /** Correlation id of the in-flight (or last) request; `null` before any. */
  requestId: string | null;
  /** Project dir of the in-flight (or last) request; `null` before any. */
  requestedRoot: string | null;
  /** The resolved payload when `phase === "ready"`. */
  payload: GitLogPayload | null;
  /** Human-readable error when `phase === "error"`. */
  error: string | null;
}

const EMPTY_SNAPSHOT: GitLogStoreSnapshot = {
  phase: "idle",
  requestId: null,
  requestedRoot: null,
  payload: null,
  error: null,
};

/** Parse a GIT_LOG feed payload into a `GitLogPayload`, or `null`. */
export function parseGitLogPayload(payload: unknown): GitLogPayload | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.request_id !== "string") return null;
  if (!Array.isArray(p.commits)) return null;
  return {
    request_id: p.request_id,
    workspace_key: typeof p.workspace_key === "string" ? p.workspace_key : "",
    branch: typeof p.branch === "string" ? p.branch : "",
    no_repo: p.no_repo === true,
    commits: p.commits as GitLogCommit[],
  };
}

/** A HEAD-moved signal from the GIT_HEAD feed (mirrors `GitHeadSignal`). */
export interface GitHeadSignal {
  workspace_key: string;
  head: string;
}

/** Parse a GIT_HEAD feed payload into a `GitHeadSignal`, or `null`. */
export function parseGitHeadSignal(payload: unknown): GitHeadSignal | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.workspace_key !== "string") return null;
  return {
    workspace_key: p.workspace_key,
    head: typeof p.head === "string" ? p.head : "",
  };
}

// ── Pure presentation helper (unit-tested) ──────────────────────────────────

/**
 * Format a log payload into the section's text blob, one line per commit in
 * wire order: `<sha9>  <date>  <author> — <subject>` (two-space column gaps, an
 * em-dash before the subject). No trailing newline; `""` for zero commits.
 */
export function formatGitLog(payload: GitLogPayload): string {
  return payload.commits
    .map((c) => `${c.sha.slice(0, 9)}  ${c.date}  ${c.author} — ${c.subject}`)
    .join("\n");
}

// ── GitLogStore ─────────────────────────────────────────────────────────────

/**
 * Store-instance counter baked into every `requestId` so concurrent requests
 * from different stores can never correlate to each other's responses — the
 * GIT_LOG response is a broadcast every client sees.
 */
let nextStoreId = 0;

export class GitLogStore {
  private _snapshot: GitLogStoreSnapshot = EMPTY_SNAPSHOT;
  private _listeners = new Set<() => void>();
  private _unsubscribeFeed: (() => void) | null = null;
  private _lastPayloadRef: unknown = undefined;
  private _lastHeadRef: unknown = undefined;
  private readonly _feedStore: FeedStore;
  private readonly _storeId: number;
  private _seq = 0;

  constructor(feedStore: FeedStore) {
    this._feedStore = feedStore;
    this._storeId = ++nextStoreId;
    this._unsubscribeFeed = feedStore.subscribe(() => {
      this._onLogUpdate();
      this._onHeadSignal();
    });
  }

  private _onLogUpdate(): void {
    const payload = this._feedStore.getSnapshot().get(FeedId.GIT_LOG);
    if (payload === this._lastPayloadRef) return;
    this._lastPayloadRef = payload;

    const parsed = parseGitLogPayload(payload);
    if (parsed === null) return;
    // Accept only the response correlated to the in-flight request. A null
    // requestId (no request sent) or a mismatch (superseded request, or a
    // replayed cached frame) never matches.
    if (parsed.request_id !== this._snapshot.requestId) return;

    this._set({
      phase: "ready",
      requestId: parsed.request_id,
      requestedRoot: this._snapshot.requestedRoot,
      payload: parsed,
      error: null,
    });
  }

  /**
   * A GIT_HEAD signal reports that some workspace's HEAD moved (a commit /
   * checkout / reset from ANY source, detected server-side by an FSEvents git
   * watch). If it names the workspace this store is currently showing, and its
   * HEAD is past the commit we have on top, re-request the log — keeping the
   * section live without polling.
   */
  private _onHeadSignal(): void {
    const frame = this._feedStore.getSnapshot().get(FeedId.GIT_HEAD);
    if (frame === this._lastHeadRef) return;
    this._lastHeadRef = frame;

    const signal = parseGitHeadSignal(frame);
    if (signal === null) return;
    const payload = this._snapshot.payload;
    if (payload === null || signal.workspace_key !== payload.workspace_key) return;
    // Already showing this HEAD? Nothing to do (dedups redundant signals).
    if (payload.commits[0]?.sha === signal.head) return;
    this.refresh();
  }

  /**
   * Request the recent log for `projectDir`. Idempotent by the requested-key
   * guard: a no-op when `projectDir` is already the requested root and the
   * phase is `loading` or `ready`, so re-renders and collapse toggles can call
   * it freely. A different root — or a prior error — fires a fresh query.
   */
  requestLog(projectDir: string, limit = 20): void {
    const s = this._snapshot;
    if (
      projectDir === s.requestedRoot &&
      (s.phase === "loading" || s.phase === "ready")
    ) {
      return;
    }
    this._send(projectDir, limit);
  }

  /** Re-request the current root unconditionally (mount + future affordances). */
  refresh(limit = 20): void {
    const root = this._snapshot.requestedRoot;
    if (root === null) return;
    this._send(root, limit);
  }

  private _send(projectDir: string, limit: number): void {
    const conn = getConnection();
    if (!conn) {
      this._set({
        phase: "error",
        requestId: null,
        requestedRoot: projectDir,
        payload: null,
        error: "Lost the connection to tugcast.",
      });
      return;
    }
    this._seq += 1;
    const requestId = `gl-${this._storeId}-${this._seq}`;
    this._set({
      phase: "loading",
      requestId,
      requestedRoot: projectDir,
      payload: null,
      error: null,
    });
    const query = { root: projectDir, requestId, limit };
    const bytes = new TextEncoder().encode(JSON.stringify(query));
    conn.send(FeedId.GIT_LOG_QUERY, bytes);
  }

  private _set(next: GitLogStoreSnapshot): void {
    this._snapshot = next;
    for (const listener of this._listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getSnapshot = (): GitLogStoreSnapshot => this._snapshot;

  /**
   * Test seam — set the store to `ready` with `payload` directly, as if a
   * matching `GIT_LOG` response had landed, bypassing the connection and the
   * request_id gate. Mirrors `GitDiffStore._ingestForTest`. @internal
   */
  _ingestForTest(payload: unknown): void {
    const parsed = parseGitLogPayload(payload);
    if (parsed === null) {
      throw new Error("GitLogStore._ingestForTest: malformed payload");
    }
    this._set({
      phase: "ready",
      requestId: parsed.request_id,
      requestedRoot: this._snapshot.requestedRoot,
      payload: parsed,
      error: null,
    });
  }

  dispose(): void {
    if (this._unsubscribeFeed) {
      this._unsubscribeFeed();
      this._unsubscribeFeed = null;
    }
    this._listeners.clear();
  }
}

// ── Shared singleton ─────────────────────────────────────────────────────────

let _feedStore: FeedStore | null = null;
let _store: GitLogStore | null = null;

/**
 * The one shared Git History store, lazily created over a shared
 * `FeedStore(conn, [GIT_LOG])`. Returns `null` when no connection is up
 * (gallery / fixtures) — callers render the empty state.
 */
export function gitLogStore(): GitLogStore | null {
  if (_store !== null) return _store;
  const conn = getConnection();
  if (!conn) return null;
  _feedStore = new FeedStore(conn, [FeedId.GIT_LOG, FeedId.GIT_HEAD]);
  _store = new GitLogStore(_feedStore);
  return _store;
}
