/**
 * changes-route-controller — the per-card Changes view-route store ([P07]).
 *
 * On the `±` route the Session card commits its session's changeset as one
 * unit ([P05]): every file this session is attributed to, one
 * `changeset_commit`. There is no per-file election — an AI session emits a
 * unified changeset; a file you don't want in it is a conversation with the
 * AI, not a checkbox. Unattributed files (no session claims them) are shown
 * for awareness but never swept into this session's commit.
 *
 * It opens NO feed of its own — the per-workspace `CHANGESET` feed (0x23)
 * is retired. Instead it subscribes to the app-level `ChangesetAllStore`
 * singleton (`CHANGESET_ALL`, 0x24 — the same store the Lens reads) and
 * derives its slice as a filtered projection: this card's project by
 * `workspace_key`, its session entry by `owner_id`, the project's dash
 * entries, and the unattributed bucket.
 *
 * The commit and draft triggers are pass-throughs to the shipping app-level
 * verb / draft stores keyed by one identity (`entryKey` /
 * `(projectDir, "session", tugSessionId)`), so the view and the entry read
 * the same round-trip state.
 *
 * @module lib/changes-route-controller
 */

import {
  ChangesetAllStore,
  getChangesetAllStore,
} from "./changeset-all-store";
import { getChangesetDraftStore } from "./changeset-draft-store";
import { getChangesetVerbStore } from "./changeset-verb-store";
import type {
  DashChangesetEntry,
  OrphanedFile,
  ProjectChangeset,
  SessionChangesetEntry,
  UnattributedFile,
  WorkspacesChangesetSnapshot,
} from "./changeset-types";

/** Identity of the card the controller is bound to. */
export interface ChangesRouteBinding {
  /** The tug session id that owns this card's changeset entry. */
  tugSessionId: string;
  /** Canonical key of the workspace this card's project lives in. */
  workspaceKey: string;
  /** Absolute checkout root — the commit target and file-link base. */
  projectDir: string;
}

/**
 * The controller's derived slice, reference-stable between recomputes so it
 * can drive `useSyncExternalStore` directly.
 */
export interface ChangesRouteSnapshot {
  /** This card session's changeset entry, or null when the feed has none yet. */
  entry: SessionChangesetEntry | null;
  /** Dash worktree entries in this workspace (their own Join affordance). */
  dashes: DashChangesetEntry[];
  /** Dirty files no owner claims. */
  unattributed: UnattributedFile[];
  /** Dirty files owned only by non-live sessions — claimable orphans ([D120]). */
  orphaned: OrphanedFile[];
  /** The project header (real feed project, or a placeholder before first emit). */
  project: ProjectChangeset;
  /** Repo-relative paths this session's commit lands — its full attributed set. */
  committedPaths: ReadonlySet<string>;
}

/**
 * Whether the entry's changes have moved since its draft was written — the
 * shade's "changes moved since this draft" marker ([P02]; advisory, never
 * blocks a landing). True when any attributed file was touched after the
 * draft's last regeneration.
 */
export function draftDrifted(entry: SessionChangesetEntry | null): boolean {
  const draft = entry?.draft;
  if (entry === null || draft === undefined) return false;
  return entry.files.some((file) => file.last_touched > draft.updated_at);
}

/**
 * A minimal project shell for a binding whose project the feed hasn't
 * emitted yet — enough identity to render immediately; the feed's next
 * frame supplies the real project. Mirrors the Lens `placeholderProject`.
 */
function placeholderProject(binding: ChangesRouteBinding): ProjectChangeset {
  const dir = binding.projectDir;
  return {
    workspace_key: binding.workspaceKey,
    project_dir: dir,
    display_name: dir.slice(dir.lastIndexOf("/") + 1) || dir,
    no_repo: false,
    branch: "",
    ahead: 0,
    behind: 0,
    head_sha: "",
    head_message: "",
    changesets: [],
    unattributed: [],
    orphaned: [],
  };
}

/**
 * Pure derivation of a card's Changes slice from the aggregate snapshot.
 * Scoped to one workspace, with the placeholder-project fallback. The
 * committed set is the session's full attributed file list — no per-file
 * election; unattributed files are surfaced but never committed by this
 * session. Exported for unit tests.
 */
export function deriveChangesRouteSnapshot(
  data: WorkspacesChangesetSnapshot,
  binding: ChangesRouteBinding,
): ChangesRouteSnapshot {
  const project =
    data.projects.find((p) => p.workspace_key === binding.workspaceKey) ??
    placeholderProject(binding);

  let entry: SessionChangesetEntry | null = null;
  const dashes: DashChangesetEntry[] = [];
  for (const changeset of project.changesets) {
    if (changeset.kind === "dash") {
      dashes.push(changeset);
    } else if (changeset.owner_id === binding.tugSessionId) {
      entry = changeset;
    }
  }

  const committedPaths = new Set<string>(
    entry?.files.map((file) => file.path) ?? [],
  );

  return {
    entry,
    dashes,
    unattributed: project.unattributed,
    orphaned: project.orphaned ?? [],
    project,
    committedPaths,
  };
}

const EMPTY_SNAPSHOT: WorkspacesChangesetSnapshot = { projects: [] };

/**
 * Per-card Changes-route store ([P07]). Constructed with the card's binding;
 * subscribes to the app-level `ChangesetAllStore` singleton and republishes
 * a filtered, selection-aware slice. `dispose` unsubscribes.
 */
export class ChangesRouteController {
  readonly tugSessionId: string;
  readonly workspaceKey: string;
  readonly projectDir: string;
  /** Verb-store commit key ([P07]) — also the draft/commit correlation id. */
  readonly entryKey: string;
  /** Draft-store owner kind for this entry. */
  readonly draftOwnerKind = "session";

  private readonly _binding: ChangesRouteBinding;
  private readonly _allStore: ChangesetAllStore | null;
  private readonly _unsubscribe: () => void;
  private readonly _listeners = new Set<() => void>();
  private _snapshot: ChangesRouteSnapshot;

  constructor(
    binding: ChangesRouteBinding,
    allStore: ChangesetAllStore | null = getChangesetAllStore(),
  ) {
    this._binding = binding;
    this.tugSessionId = binding.tugSessionId;
    this.workspaceKey = binding.workspaceKey;
    this.projectDir = binding.projectDir;
    this.entryKey = `session:${binding.tugSessionId}`;
    this._allStore = allStore;
    this._snapshot = this._derive();
    this._unsubscribe =
      allStore !== null ? allStore.subscribe(() => this._recompute()) : () => {};
  }

  private _derive(): ChangesRouteSnapshot {
    const data = this._allStore?.getSnapshot() ?? EMPTY_SNAPSHOT;
    return deriveChangesRouteSnapshot(data, this._binding);
  }

  private _recompute(): void {
    this._snapshot = this._derive();
    for (const listener of [...this._listeners]) listener();
  }

  // ── Store surface ([L02]) ──────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getSnapshot = (): ChangesRouteSnapshot => this._snapshot;

  // ── Triggers ───────────────────────────────────────────────────────────

  /** The message of the most recent commit this controller initiated —
   *  the landing receipt's subject source ([P09]; the verb store's reply
   *  carries sha + numstat but not the message). */
  private _lastCommitMessage: string | null = null;

  /** See {@link _lastCommitMessage}. */
  lastCommitMessage(): string | null {
    return this._lastCommitMessage;
  }

  /**
   * Commit the current selection with `message` via the app-level verb store
   * ([P07]). No-op when the selection is empty or no store is attached.
   */
  commit(message: string): void {
    const files = [...this._snapshot.committedPaths];
    if (files.length === 0) return;
    this._lastCommitMessage = message;
    // Carry the session's display name + id so `do_changeset_commit` appends a
    // `Tug-Session:` trailer ([P08], Spec S01). Sourced from the CHANGESET
    // entry; absent an entry (an unattributed-only commit), the id still
    // resolves from the binding and the backend simply omits the trailer.
    const entry = this._snapshot.entry;
    getChangesetVerbStore()?.commit(
      this.entryKey,
      this.projectDir,
      files,
      message,
      { name: entry?.display_name, id: entry?.owner_id ?? this.tugSessionId },
    );
  }

  /**
   * Claim unattributed files for this session: promote the given repo-relative
   * paths from "likely" hints into this session's changeset. Keyed by the
   * aggregate's canonical project spelling (`project.project_dir`) so the
   * claim rows land under the same project the unattributed rows compose
   * against. No-op when the store is absent or `paths` is empty.
   */
  claim(paths: string[]): void {
    if (paths.length === 0) return;
    getChangesetVerbStore()?.claim(
      this._snapshot.project.project_dir,
      this.tugSessionId,
      paths,
    );
  }

  /**
   * Nudge the server to re-scan the working tree and recompose the aggregate.
   * Fired when the Changes shade opens so a just-created orphan surfaces the
   * moment you look, rather than waiting on the next FS-watch bump. No-op when
   * no verb store is attached; the recompose is diff-suppressed server-side.
   */
  refresh(): void {
    getChangesetVerbStore()?.refresh();
  }

  /** Request an on-demand AI draft for this entry ([P06]). `force` is the
   *  confirmed Regenerate — the only path that overwrites an edited draft
   *  ([P03]). */
  requestDraft(force = false): void {
    getChangesetDraftStore()?.requestDraft(
      this.projectDir,
      this.draftOwnerKind,
      this.tugSessionId,
      force,
    );
  }

  dispose(): void {
    this._unsubscribe();
    this._listeners.clear();
  }
}
