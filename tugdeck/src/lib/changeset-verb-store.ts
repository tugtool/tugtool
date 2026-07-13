/**
 * Changeset card CONTROL verbs — app-level round-trip store.
 *
 * M02A carries a single verb, `changeset_git_init { project_dir }`: the
 * non-repo "Initialize git" affordance. The deck sends the CONTROL request and
 * tugcast's supervisor replies `changeset_git_init_ok { project_dir }` /
 * `changeset_git_init_err { project_dir, detail }` (Spec S07). On success the
 * server fires the aggregate recompute, so the project's section self-heals to
 * a clean repo and drops its Init affordance — there is no client-side flip;
 * this store only tracks the in-flight request and any error to surface.
 *
 * State is keyed by `project_dir` (several non-repo projects can be open at
 * once). Consumed via {@link useChangesetGitInit}; attached once at app boot
 * with {@link attachChangesetVerbStore}. (M03's `changeset_commit` /
 * `changeset_summarize` verbs extend this store.)
 *
 * Laws: [L02] external state enters React through useSyncExternalStore only.
 *
 * @module lib/changeset-verb-store
 */

import { useSyncExternalStore } from "react";

import type { TugConnection } from "../connection";
import { FeedId } from "../protocol";

export type GitInitPhase = "idle" | "pending" | "error";

export interface GitInitState {
  phase: GitInitPhase;
  error: string | null;
}

/** Shared idle state — a stable reference so `useSyncExternalStore` is quiet. */
const IDLE: GitInitState = Object.freeze({ phase: "idle", error: null });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class ChangesetVerbStore {
  private readonly _connection: TugConnection;
  private readonly _unsubscribe: () => void;
  private readonly _listeners = new Set<() => void>();
  /** project_dir → git-init request state. Absent ⇒ idle. */
  private _gitInit = new Map<string, GitInitState>();
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
    const projectDir = typeof body.project_dir === "string" ? body.project_dir : null;
    if (projectDir === null) return;

    if (body.action === "changeset_git_init_ok") {
      // Success: the aggregate recompute (server bump) removes this project's
      // non-repo section shortly. Clear the in-flight state meanwhile.
      this._setGitInit(projectDir, IDLE);
    } else if (body.action === "changeset_git_init_err") {
      const detail = typeof body.detail === "string" ? body.detail : "git init failed";
      this._setGitInit(projectDir, { phase: "error", error: detail });
    }
  }

  private _setGitInit(projectDir: string, state: GitInitState): void {
    if (state.phase === "idle") {
      this._gitInit.delete(projectDir);
    } else {
      this._gitInit.set(projectDir, state);
    }
    for (const listener of [...this._listeners]) listener();
  }

  /** Send `changeset_git_init` for `projectDir` and mark it in-flight. */
  gitInit(projectDir: string): void {
    this._setGitInit(projectDir, { phase: "pending", error: null });
    this._connection.sendControlFrame("changeset_git_init", { project_dir: projectDir });
  }

  gitInitState(projectDir: string): GitInitState {
    return this._gitInit.get(projectDir) ?? IDLE;
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

// ---------------------------------------------------------------------------
// Singleton + hook
// ---------------------------------------------------------------------------

let _activeStore: ChangesetVerbStore | null = null;

export function attachChangesetVerbStore(conn: TugConnection): ChangesetVerbStore {
  if (_activeStore !== null) return _activeStore;
  _activeStore = new ChangesetVerbStore(conn);
  return _activeStore;
}

export function getChangesetVerbStore(): ChangesetVerbStore | null {
  return _activeStore;
}

/** Test-only: detach the singleton between cases. */
export function _resetChangesetVerbStoreForTest(): void {
  _activeStore?.dispose();
  _activeStore = null;
}

/**
 * React hook: the git-init round-trip state for one project plus its trigger.
 * Returns idle + a no-op `init` when no store is attached (gallery / fixtures).
 */
export function useChangesetGitInit(projectDir: string): GitInitState & { init: () => void } {
  const state = useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => _activeStore?.gitInitState(projectDir) ?? IDLE,
    () => IDLE,
  );
  const init = (): void => {
    _activeStore?.gitInit(projectDir);
  };
  return { ...state, init };
}
