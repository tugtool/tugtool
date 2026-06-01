/**
 * GitDiffStore — single-shot `/diff` request/response over the GIT_DIFF
 * feeds ([#step-10b]).
 *
 * `/diff` is a one-shot, not a continuous feed: the sheet asks for the
 * project's `git diff HEAD` once (and again on an explicit refresh), and
 * tugcast answers with a single `GIT_DIFF` (0x21) frame. This store sends
 * the `GIT_DIFF_QUERY` (0x22) carrying the card's project dir as `root`
 * (the same dir behind the Z4B chip — tugcast resolves the matching
 * workspace) plus a correlating `requestId`, and resolves the response whose
 * `request_id` matches the in-flight request. Stale responses (a slow reply
 * to a superseded request, or a workspace-filtered replay) are ignored.
 *
 * The owning `FeedStore` is workspace-key-filtered (see `card-services-store`)
 * so a card only ever sees its own project's diff; `requestId` disambiguates
 * rapid refreshes within that card.
 *
 * Pure presentation helpers (`formatDiffStat`, `diffStatusLabel`,
 * `diffSummaryLine`, `fileStatLabel`) live here too so the accordion mapping
 * is unit-testable without React or a live connection.
 *
 * @module lib/git-diff-store
 */

import type { FeedStore } from "./feed-store";
import type { FeedIdValue } from "../protocol";
import { FeedId } from "../protocol";
import { getConnection } from "./connection-singleton";

// ── Wire types (mirror tugcast-core `GitDiffSnapshot`) ──────────────────────

/** How a file changed relative to `HEAD`. */
export type GitDiffFileStatus = "added" | "modified" | "deleted" | "renamed";

/** One changed file in a `git diff HEAD` payload. */
export interface GitDiffFile {
  /** Path relative to the repo root (the rename destination when renamed). */
  path: string;
  /** Original path for a rename; absent otherwise. */
  old_path?: string;
  status: GitDiffFileStatus;
  /** Count of added (`+`) body lines. */
  added: number;
  /** Count of removed (`-`) body lines. */
  removed: number;
  /** True when git reported a binary file (no textual hunks). */
  binary: boolean;
  /** The file's complete unified-diff chunk, verbatim from git. */
  unified: string;
}

/** A single-shot `git diff HEAD` payload from tugcast (GIT_DIFF feed). */
export interface GitDiffPayload {
  request_id: string;
  workspace_key: string;
  base: string;
  /** True when the project dir is not inside a git working tree. */
  no_repo: boolean;
  file_count: number;
  total_added: number;
  total_removed: number;
  files: GitDiffFile[];
}

/** Lifecycle of the current/last `/diff` request. */
export type GitDiffPhase = "idle" | "loading" | "ready" | "error";

/** Reactive snapshot the sheet renders via `useSyncExternalStore`. */
export interface GitDiffSnapshot {
  phase: GitDiffPhase;
  /** Correlation id of the in-flight (or last) request; `null` before any. */
  requestId: string | null;
  /** The resolved payload when `phase === "ready"`. */
  payload: GitDiffPayload | null;
  /** Human-readable error when `phase === "error"`. */
  error: string | null;
}

const EMPTY_SNAPSHOT: GitDiffSnapshot = {
  phase: "idle",
  requestId: null,
  payload: null,
  error: null,
};

// ── Pure presentation helpers (unit-tested) ─────────────────────────────────

const STATUS_LABELS: Record<GitDiffFileStatus, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
};

/** Human label for a file's change status. */
export function diffStatusLabel(status: GitDiffFileStatus): string {
  return STATUS_LABELS[status];
}

const STATUS_LETTERS: Record<GitDiffFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

/** Single-letter status badge (git-porcelain style: A / M / D / R). */
export function diffStatusLetter(status: GitDiffFileStatus): string {
  return STATUS_LETTERS[status];
}

/**
 * Format an added/removed pair as `+10 −2`, using a true minus sign
 * (U+2212) to match the `/rewind` diff-stat presentation.
 */
export function formatDiffStat(added: number, removed: number): string {
  return `+${added} −${removed}`;
}

/**
 * Stat label for a file's accordion trigger: `binary` for binary files
 * (which carry no line counts), else `+N −M`.
 */
export function fileStatLabel(file: GitDiffFile): string {
  return file.binary ? "binary" : formatDiffStat(file.added, file.removed);
}

/**
 * The summary line for the sheet header, mirroring Claude Code's
 * "N files changed +X −Y". Pluralizes "file", and omits the stat tail
 * entirely when nothing changed.
 */
export function diffSummaryLine(
  fileCount: number,
  totalAdded: number,
  totalRemoved: number,
): string {
  if (fileCount === 0) return "No uncommitted changes";
  const noun = fileCount === 1 ? "file" : "files";
  return `${fileCount} ${noun} changed ${formatDiffStat(totalAdded, totalRemoved)}`;
}

/** Parse a GIT_DIFF feed payload into a `GitDiffPayload`, or `null`. */
export function parseGitDiffPayload(payload: unknown): GitDiffPayload | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.request_id !== "string") return null;
  if (!Array.isArray(p.files)) return null;
  return {
    request_id: p.request_id,
    workspace_key: typeof p.workspace_key === "string" ? p.workspace_key : "",
    base: typeof p.base === "string" ? p.base : "HEAD",
    no_repo: p.no_repo === true,
    file_count: typeof p.file_count === "number" ? p.file_count : p.files.length,
    total_added: typeof p.total_added === "number" ? p.total_added : 0,
    total_removed: typeof p.total_removed === "number" ? p.total_removed : 0,
    files: p.files as GitDiffFile[],
  };
}

// ── GitDiffStore ────────────────────────────────────────────────────────────

export class GitDiffStore {
  private _snapshot: GitDiffSnapshot = EMPTY_SNAPSHOT;
  private _listeners = new Set<() => void>();
  private _unsubscribeFeed: (() => void) | null = null;
  private _lastPayloadRef: unknown = undefined;
  private readonly _feedStore: FeedStore;
  private readonly _feedId: FeedIdValue;
  private readonly _projectDir: string | undefined;
  private _seq = 0;

  constructor(feedStore: FeedStore, feedId: FeedIdValue, projectDir?: string) {
    this._feedStore = feedStore;
    this._feedId = feedId;
    this._projectDir = projectDir;
    this._unsubscribeFeed = feedStore.subscribe(() => this._onFeedUpdate());
    // No initial check: a `/diff` response only matters once we've sent a
    // request (`requestId` is null until then, so nothing would match).
  }

  private _onFeedUpdate(): void {
    const payload = this._feedStore.getSnapshot().get(this._feedId);
    if (payload === this._lastPayloadRef) return;
    this._lastPayloadRef = payload;

    const parsed = parseGitDiffPayload(payload);
    if (parsed === null) return;
    // Accept only the response correlated to the in-flight request. A null
    // requestId (no request sent) or a mismatch (superseded request, or a
    // replayed cached frame) never matches.
    if (parsed.request_id !== this._snapshot.requestId) return;

    this._set({
      phase: "ready",
      requestId: parsed.request_id,
      payload: parsed,
      error: null,
    });
  }

  /**
   * Fire a fresh `git diff HEAD` request for this card's project dir. Moves
   * the store to `loading` under a new `requestId`; the matching `GIT_DIFF`
   * response resolves it to `ready`. Re-callable for the refresh control.
   */
  requestDiff(): void {
    const conn = getConnection();
    if (!conn) {
      this._set({
        phase: "error",
        requestId: null,
        payload: null,
        error: "Lost the connection to tugcast.",
      });
      return;
    }
    this._seq += 1;
    const requestId = `gd-${this._seq}`;
    const query: Record<string, string> = { requestId };
    if (this._projectDir !== undefined && this._projectDir.length > 0) {
      query.root = this._projectDir;
    }
    this._set({ phase: "loading", requestId, payload: null, error: null });
    const bytes = new TextEncoder().encode(JSON.stringify(query));
    conn.send(FeedId.GIT_DIFF_QUERY, bytes);
  }

  private _set(next: GitDiffSnapshot): void {
    this._snapshot = next;
    for (const listener of this._listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getSnapshot = (): GitDiffSnapshot => this._snapshot;

  /**
   * Test seam — set the store to `ready` with `payload` directly, as if a
   * matching `GIT_DIFF` response had landed, bypassing the connection and the
   * request_id gate. Mirrors `SessionMetadataStore._ingestForTest`; lets the
   * `/diff` app-test render the sheet deterministically without a live git
   * round-trip (which 10.A's subprocess test already proves). @internal
   */
  _ingestForTest(payload: unknown): void {
    const parsed = parseGitDiffPayload(payload);
    if (parsed === null) {
      throw new Error("GitDiffStore._ingestForTest: malformed payload");
    }
    this._set({
      phase: "ready",
      requestId: parsed.request_id,
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
