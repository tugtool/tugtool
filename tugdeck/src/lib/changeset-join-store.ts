/**
 * Changeset dash-join resolve overlay store — the `/btw`-style progress layer
 * over the resolution ladder's CONTROL frames (Spec S12, [P31]/[P32]).
 *
 * When the card asks tugcast to resolve a conflicted join, the ladder streams
 * `changeset_join_resolve_delta` frames (per file / rung, with the AI rung's
 * accumulated text) and finishes with `changeset_join_resolve_ok`
 * (resolved/unresolved/candidate/shape) or `_err`. This store keys that live
 * state by `(project_dir, dash)` and exposes it via `useSyncExternalStore`
 * ([L02]); the card renders a mini-transcript overlay while resolving, then a
 * reviewable result. The candidate is landed separately (a `changeset_join`
 * with the candidate) once the user confirms — this store never lands.
 *
 * Attached once at boot with {@link attachChangesetJoinStore}; consumed via
 * {@link useChangesetJoinResolve}.
 *
 * @module lib/changeset-join-store
 */

import { useSyncExternalStore } from "react";

import type { TugConnection } from "../connection";
import { FeedId } from "../protocol";

export type ResolvePhase = "idle" | "resolving" | "resolved" | "partial" | "error";

/** One conflicted file's live resolution progress (from the deltas). */
export interface FileProgress {
  path: string;
  rung: string;
  status: string;
  /** The AI rung's accumulated text, when streaming. */
  text: string;
}

/** One file's terminal resolution (from the ok frame). */
export interface ResolvedFile {
  path: string;
  resolvedBy: string;
}

/** The live resolve state for one dash. */
export interface ResolveState {
  phase: ResolvePhase;
  /** Per-file streaming progress while `phase === "resolving"`. */
  progress: readonly FileProgress[];
  /** Files the ladder resolved (terminal). */
  resolved: readonly ResolvedFile[];
  /** Files still conflicting (terminal; non-empty ⇒ `partial`). */
  unresolved: readonly string[];
  /** The pre-built candidate commit to land, when fully resolved. */
  candidateCommit: string | null;
  /** `"squash"` | `"replay"` (terminal). */
  shape: string | null;
  /** Error detail when `phase === "error"`. */
  error: string | null;
}

const IDLE: ResolveState = Object.freeze({
  phase: "idle",
  progress: Object.freeze([]) as readonly FileProgress[],
  resolved: Object.freeze([]) as readonly ResolvedFile[],
  unresolved: Object.freeze([]) as readonly string[],
  candidateCommit: null,
  shape: null,
  error: null,
});

function key(projectDir: string, dash: string): string {
  return `${projectDir}|${dash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export class ChangesetJoinStore {
  private readonly _connection: TugConnection;
  private readonly _unsubscribe: () => void;
  private readonly _listeners = new Set<() => void>();
  private _states = new Map<string, ResolveState>();
  private readonly _decoder = new TextDecoder();

  constructor(connection: TugConnection) {
    this._connection = connection;
    this._unsubscribe = connection.onFrame(FeedId.CONTROL, (payload) =>
      this._onControl(payload),
    );
  }

  private _onControl(payload: Uint8Array): void {
    let body: unknown;
    try {
      body = JSON.parse(this._decoder.decode(payload));
    } catch {
      return;
    }
    if (!isRecord(body) || typeof body.action !== "string") return;
    const action = body.action;
    if (
      action !== "changeset_join_resolve_delta" &&
      action !== "changeset_join_resolve_ok" &&
      action !== "changeset_join_resolve_err"
    ) {
      return;
    }
    const projectDir = typeof body.project_dir === "string" ? body.project_dir : null;
    const dash = typeof body.dash === "string" ? body.dash : null;
    if (projectDir === null || dash === null) return;
    const k = key(projectDir, dash);
    const prev = this._states.get(k) ?? IDLE;

    if (action === "changeset_join_resolve_delta") {
      const path = typeof body.path === "string" ? body.path : "";
      const rung = typeof body.rung === "string" ? body.rung : "";
      const status = typeof body.status === "string" ? body.status : "";
      const text = typeof body.text === "string" ? body.text : "";
      const progress = prev.progress.filter((p) => p.path !== path);
      this._set(k, {
        ...prev,
        phase: "resolving",
        progress: [...progress, { path, rung, status, text }],
        error: null,
      });
      return;
    }

    if (action === "changeset_join_resolve_ok") {
      const resolvedRaw = Array.isArray(body.resolved) ? body.resolved : [];
      const resolved: ResolvedFile[] = resolvedRaw
        .filter(isRecord)
        .map((r) => ({
          path: typeof r.path === "string" ? r.path : "",
          resolvedBy: typeof r.resolved_by === "string" ? r.resolved_by : "",
        }));
      const unresolved = readStringArray(body.unresolved);
      const candidateCommit =
        typeof body.candidate_commit === "string" ? body.candidate_commit : null;
      const shape = typeof body.shape === "string" ? body.shape : null;
      this._set(k, {
        ...prev,
        phase: unresolved.length > 0 ? "partial" : "resolved",
        resolved,
        unresolved,
        candidateCommit,
        shape,
        error: null,
      });
      return;
    }

    // changeset_join_resolve_err
    const detail = typeof body.detail === "string" ? body.detail : "resolve failed";
    this._set(k, { ...prev, phase: "error", error: detail });
  }

  private _set(k: string, state: ResolveState): void {
    if (state.phase === "idle") {
      this._states.delete(k);
    } else {
      this._states.set(k, state);
    }
    for (const listener of [...this._listeners]) listener();
  }

  /** Send `changeset_join_resolve` and mark the dash resolving (fresh state). */
  resolve(projectDir: string, dash: string): void {
    this._set(key(projectDir, dash), {
      phase: "resolving",
      progress: [],
      resolved: [],
      unresolved: [],
      candidateCommit: null,
      shape: null,
      error: null,
    });
    this._connection.sendControlFrame("changeset_join_resolve", {
      project_dir: projectDir,
      dash,
    });
  }

  state(projectDir: string, dash: string): ResolveState {
    return this._states.get(key(projectDir, dash)) ?? IDLE;
  }

  /** Clear a dash's resolve state (cancel / after landing). */
  clear(projectDir: string, dash: string): void {
    this._set(key(projectDir, dash), IDLE);
  }

  dispose(): void {
    this._unsubscribe();
    this._listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };
}

let _activeStore: ChangesetJoinStore | null = null;

export function attachChangesetJoinStore(conn: TugConnection): ChangesetJoinStore {
  if (_activeStore !== null) return _activeStore;
  _activeStore = new ChangesetJoinStore(conn);
  return _activeStore;
}

/** Test-only: detach the singleton between cases. */
export function _resetChangesetJoinStoreForTest(): void {
  _activeStore?.dispose();
  _activeStore = null;
}

/** Test-only: feed a CONTROL frame body as if it arrived over the wire. */
export function _ingestJoinFrameForTest(body: unknown): void {
  if (_activeStore === null) return;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  (_activeStore as unknown as { _onControl(p: Uint8Array): void })._onControl(bytes);
}

/**
 * React hook: the live resolve state for one dash plus its triggers. Returns
 * idle + no-op triggers when no store is attached (gallery / fixtures).
 */
export function useChangesetJoinResolve(
  projectDir: string,
  dash: string,
): ResolveState & { resolve: () => void; clear: () => void } {
  const state = useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => _activeStore?.state(projectDir, dash) ?? IDLE,
    () => IDLE,
  );
  const resolve = (): void => {
    _activeStore?.resolve(projectDir, dash);
  };
  const clear = (): void => {
    _activeStore?.clear(projectDir, dash);
  };
  return { ...state, resolve, clear };
}
