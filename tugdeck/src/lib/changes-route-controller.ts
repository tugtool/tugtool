/**
 * changes-route-controller — the per-card Changes view-route store ([P07]).
 *
 * On the `±` route the Session card commits the *head selection*: its own
 * session's changed files plus the project's unattributed files, one
 * selection set, one `changeset_commit` ([P05]). The controller is the
 * [L02]-conformant meeting point between the prompt entry (which reads the
 * selection at submit time) and the ChangesView (which draws the
 * checkboxes).
 *
 * It opens NO feed of its own — the per-workspace `CHANGESET` feed (0x23)
 * is retired. Instead it subscribes to the app-level `ChangesetAllStore`
 * singleton (`CHANGESET_ALL`, 0x24 — the same store the Lens reads) and
 * derives its slice as a filtered projection: this card's project by
 * `workspace_key`, its session entry by `owner_id`, the project's dash
 * entries, and the unattributed bucket. Selection is layered on top as an
 * override map over the Lens default rule (`!ambiguous && !shared` for
 * session files, always-on for unattributed).
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
  ChangesetFile,
  DashChangesetEntry,
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
  /** The project header (real feed project, or a placeholder before first emit). */
  project: ProjectChangeset;
  /** Repo-relative paths currently selected for commit (session + unattributed). */
  selectedPaths: ReadonlySet<string>;
}

/** The commit-selection default for a session file: on unless ambiguous or shared. */
export function sessionFileDefaultSelected(file: ChangesetFile): boolean {
  return !file.ambiguous && !file.shared;
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
  };
}

/**
 * Pure derivation of a card's Changes slice from the aggregate snapshot.
 * Scoped to one workspace (`buildItems` scoped to a single project), with
 * the same placeholder-project fallback and the same selection defaults an
 * `override` map is layered over. Exported for unit tests.
 */
export function deriveChangesRouteSnapshot(
  data: WorkspacesChangesetSnapshot,
  binding: ChangesRouteBinding,
  overrides: ReadonlyMap<string, boolean>,
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

  const selectedPaths = new Set<string>();
  const consider = (path: string, defaultOn: boolean): void => {
    const on = overrides.has(path) ? (overrides.get(path) as boolean) : defaultOn;
    if (on) selectedPaths.add(path);
  };
  if (entry !== null) {
    for (const file of entry.files) {
      consider(file.path, sessionFileDefaultSelected(file));
    }
  }
  for (const file of project.unattributed) {
    consider(file.path, true);
  }

  return {
    entry,
    dashes,
    unattributed: project.unattributed,
    project,
    selectedPaths,
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
  private readonly _overrides = new Map<string, boolean>();
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
    return deriveChangesRouteSnapshot(data, this._binding, this._overrides);
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

  // ── Selection ──────────────────────────────────────────────────────────

  /** Whether a path is currently selected for commit. */
  isSelected(path: string): boolean {
    return this._snapshot.selectedPaths.has(path);
  }

  /** Override the default selection for a path. */
  setSelected(path: string, on: boolean): void {
    this._overrides.set(path, on);
    this._recompute();
  }

  /** The selected repo-relative paths, in the snapshot's set order. */
  selectedPaths(): string[] {
    return [...this._snapshot.selectedPaths];
  }

  /** Drop all selection overrides back to the defaults. */
  clearSelectionOverrides(): void {
    if (this._overrides.size === 0) return;
    this._overrides.clear();
    this._recompute();
  }

  // ── Triggers ───────────────────────────────────────────────────────────

  /**
   * Commit the current selection with `message` via the app-level verb store
   * ([P07]). No-op when the selection is empty or no store is attached.
   */
  commit(message: string): void {
    const files = this.selectedPaths();
    if (files.length === 0) return;
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

  /** Request an on-demand AI draft for this entry ([P06]). */
  requestDraft(): void {
    getChangesetDraftStore()?.requestDraft(
      this.projectDir,
      this.draftOwnerKind,
      this.tugSessionId,
    );
  }

  dispose(): void {
    this._unsubscribe();
    this._listeners.clear();
  }
}
