/**
 * Changeset card CONTROL verbs — app-level round-trip store.
 *
 * Two verbs ride here. `changeset_git_init { project_dir }` is the non-repo
 * "Initialize git" affordance: the deck sends the CONTROL request and
 * tugcast's supervisor replies `changeset_git_init_ok { project_dir }` /
 * `changeset_git_init_err { project_dir, detail }` (Spec S07). On success the
 * server fires the aggregate recompute, so the project's section self-heals to
 * a clean repo and drops its Init affordance — there is no client-side flip;
 * this store only tracks the in-flight request and any error to surface.
 *
 * `changeset_commit { project_dir, files, message }` commits exactly the
 * card-selected files (Spec S03, [P15]); the reply carries the new HEAD sha
 * and the numstat receipt (`_ok {sha, receipt}`) or the git stderr detail
 * (`_err {detail}`). Commit state is keyed by the initiating card *entry*
 * (the response only names the project, so the store correlates through a
 * project→entry in-flight map).
 *
 * Git-init state is keyed by `project_dir` (several non-repo projects can be
 * open at once). Consumed via {@link useChangesetGitInit} /
 * {@link useChangesetCommit}; attached once at app boot with
 * {@link attachChangesetVerbStore}.
 *
 * Laws: [L02] external state enters React through useSyncExternalStore only.
 *
 * @module lib/changeset-verb-store
 */

import { useSyncExternalStore } from "react";

import type { TugConnection } from "../connection";
import { FeedId } from "../protocol";
import { tugDevLogStore } from "./tug-dev-log-store/tug-dev-log-store";

export type GitInitPhase = "idle" | "pending" | "error";

export interface GitInitState {
  phase: GitInitPhase;
  error: string | null;
}

/** Shared idle state — a stable reference so `useSyncExternalStore` is quiet. */
const IDLE: GitInitState = Object.freeze({ phase: "idle", error: null });

export type CommitPhase = "idle" | "pending" | "error" | "done";

/** One commit round trip's state, keyed by the initiating card entry. */
export interface CommitState {
  phase: CommitPhase;
  error: string | null;
  /** New HEAD sha when `phase === "done"`. */
  sha: string | null;
  /** `git show --numstat --format= HEAD` receipt when `phase === "done"`. */
  receipt: string | null;
}

const COMMIT_IDLE: CommitState = Object.freeze({
  phase: "idle",
  error: null,
  sha: null,
  receipt: null,
});

/** What the scribe is asked to produce (Spec S03 `kind`). */
export type SummarizeKind = "summary" | "commit_message";

export type SummarizePhase = "idle" | "pending" | "error" | "done";

/** One scribe round trip's state, keyed by (card entry, kind). */
export interface SummarizeState {
  phase: SummarizePhase;
  error: string | null;
  /** The generated text when `phase === "done"`. */
  text: string | null;
}

const SUMMARIZE_IDLE: SummarizeState = Object.freeze({
  phase: "idle",
  error: null,
  text: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class ChangesetVerbStore {
  private readonly _connection: TugConnection;
  private readonly _unsubscribe: () => void;
  private readonly _listeners = new Set<() => void>();
  /** project_dir → git-init request state. Absent ⇒ idle. */
  private _gitInit = new Map<string, GitInitState>();
  /** entry key → commit round-trip state. Absent ⇒ idle. */
  private _commits = new Map<string, CommitState>();
  /** project_dir → the entry key whose commit is in flight. */
  private _commitInflight = new Map<string, string>();
  /** `entryKey|kind` → scribe round-trip state. Absent ⇒ idle. */
  private _summaries = new Map<string, SummarizeState>();
  /** `project_dir|owner_id|kind` → the `entryKey|kind` in flight. */
  private _summarizeInflight = new Map<string, string>();
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
    } else if (body.action === "changeset_commit_ok") {
      const entryKey = this._commitInflight.get(projectDir);
      if (entryKey === undefined) return;
      this._commitInflight.delete(projectDir);
      this._setCommit(entryKey, {
        phase: "done",
        error: null,
        sha: typeof body.sha === "string" ? body.sha : null,
        receipt: typeof body.receipt === "string" ? body.receipt : null,
      });
    } else if (body.action === "changeset_commit_err") {
      const entryKey = this._commitInflight.get(projectDir);
      if (entryKey === undefined) return;
      this._commitInflight.delete(projectDir);
      const detail = typeof body.detail === "string" ? body.detail : "git commit failed";
      this._setCommit(entryKey, { phase: "error", error: detail, sha: null, receipt: null });
    } else if (
      body.action === "changeset_summarize_ok" ||
      body.action === "changeset_summarize_err"
    ) {
      const ownerId = typeof body.owner_id === "string" ? body.owner_id : "";
      const kind = typeof body.kind === "string" ? body.kind : "";
      const stateKey = this._summarizeInflight.get(`${projectDir}|${ownerId}|${kind}`);
      if (stateKey === undefined) return;
      this._summarizeInflight.delete(`${projectDir}|${ownerId}|${kind}`);
      if (body.action === "changeset_summarize_ok") {
        const text = typeof body.text === "string" ? body.text : "";
        this._setSummarize(stateKey, { phase: "done", error: null, text });
      } else {
        const detail = typeof body.detail === "string" ? body.detail : "scribe failed";
        // Scribe failures also land in the TugDevPanel log ([P11] — never
        // the console) so the raw detail survives past the alert.
        tugDevLogStore.warn("changeset-scribe", "changeset_summarize failed", {
          project_dir: projectDir,
          kind,
          detail,
        });
        this._setSummarize(stateKey, { phase: "error", error: detail, text: null });
      }
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

  private _setCommit(entryKey: string, state: CommitState): void {
    if (state.phase === "idle") {
      this._commits.delete(entryKey);
    } else {
      this._commits.set(entryKey, state);
    }
    for (const listener of [...this._listeners]) listener();
  }

  /**
   * Send `changeset_commit` and mark `entryKey` (the initiating card entry)
   * in-flight. The response carries only `project_dir`, so the store keeps a
   * project→entry map for the duration of the round trip — one in-flight
   * commit per project (a second send for the same project supersedes the
   * first's correlation, matching git's own one-at-a-time reality).
   */
  commit(entryKey: string, projectDir: string, files: string[], message: string): void {
    this._commitInflight.set(projectDir, entryKey);
    this._setCommit(entryKey, { phase: "pending", error: null, sha: null, receipt: null });
    this._connection.sendControlFrame("changeset_commit", {
      project_dir: projectDir,
      files,
      message,
    });
  }

  commitState(entryKey: string): CommitState {
    return this._commits.get(entryKey) ?? COMMIT_IDLE;
  }

  /** Clear a terminal (done/error) commit state back to idle. */
  clearCommit(entryKey: string): void {
    this._setCommit(entryKey, COMMIT_IDLE);
  }

  private _setSummarize(stateKey: string, state: SummarizeState): void {
    if (state.phase === "idle") {
      this._summaries.delete(stateKey);
    } else {
      this._summaries.set(stateKey, state);
    }
    for (const listener of [...this._listeners]) listener();
  }

  /**
   * Send `changeset_summarize` for one card entry. Correlation mirrors the
   * commit verb: the response echoes `{project_dir, owner_id, kind}`, which
   * the in-flight map resolves back to the initiating entry.
   */
  summarize(
    entryKey: string,
    request: {
      projectDir: string;
      ownerKind: string;
      ownerId: string;
      files: string[];
      kind: SummarizeKind;
    },
  ): void {
    const stateKey = `${entryKey}|${request.kind}`;
    this._summarizeInflight.set(
      `${request.projectDir}|${request.ownerId}|${request.kind}`,
      stateKey,
    );
    this._setSummarize(stateKey, { phase: "pending", error: null, text: null });
    this._connection.sendControlFrame("changeset_summarize", {
      project_dir: request.projectDir,
      owner_kind: request.ownerKind,
      owner_id: request.ownerId,
      files: request.files,
      kind: request.kind,
    });
  }

  summarizeState(entryKey: string, kind: SummarizeKind): SummarizeState {
    return this._summaries.get(`${entryKey}|${kind}`) ?? SUMMARIZE_IDLE;
  }

  /** Clear a terminal (done/error) scribe state back to idle. */
  clearSummarize(entryKey: string, kind: SummarizeKind): void {
    this._setSummarize(`${entryKey}|${kind}`, SUMMARIZE_IDLE);
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

/**
 * React hook: the commit round-trip state for one card entry plus its
 * triggers. Returns idle + no-op triggers when no store is attached
 * (gallery / fixtures).
 */
export function useChangesetCommit(entryKey: string): CommitState & {
  commit: (projectDir: string, files: string[], message: string) => void;
  clear: () => void;
} {
  const state = useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => _activeStore?.commitState(entryKey) ?? COMMIT_IDLE,
    () => COMMIT_IDLE,
  );
  const commit = (projectDir: string, files: string[], message: string): void => {
    _activeStore?.commit(entryKey, projectDir, files, message);
  };
  const clear = (): void => {
    _activeStore?.clearCommit(entryKey);
  };
  return { ...state, commit, clear };
}

/**
 * React hook: one scribe kind's round-trip state for one card entry plus its
 * triggers. Returns idle + no-op triggers when no store is attached.
 */
export function useChangesetSummarize(
  entryKey: string,
  kind: SummarizeKind,
): SummarizeState & {
  summarize: (request: { projectDir: string; ownerKind: string; ownerId: string; files: string[] }) => void;
  clear: () => void;
} {
  const state = useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => _activeStore?.summarizeState(entryKey, kind) ?? SUMMARIZE_IDLE,
    () => SUMMARIZE_IDLE,
  );
  const summarize = (request: {
    projectDir: string;
    ownerKind: string;
    ownerId: string;
    files: string[];
  }): void => {
    _activeStore?.summarize(entryKey, { ...request, kind });
  };
  const clear = (): void => {
    _activeStore?.clearSummarize(entryKey, kind);
  };
  return { ...state, summarize, clear };
}
