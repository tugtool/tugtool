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
 * override map over the default rule: `!shared` for session files,
 * always-OFF for unattributed (no owner claims them — inclusion is an
 * explicit election, mirroring the CLI's exit-3 refusal).
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
  ChangesetDraftSelection,
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
  /** Repo-relative paths currently selected for commit (session files by default; unattributed only by explicit election). */
  selectedPaths: ReadonlySet<string>;
}

/** The commit-selection default for a session file: on unless shared. */
export function sessionFileDefaultSelected(file: ChangesetFile): boolean {
  return !file.shared;
}

/**
 * Persisted selection dispositions → override map ([P02]): `include` paths
 * override ON, `exclude` paths override OFF. The inverse of
 * {@link selectionFromOverrides}.
 */
export function overridesFromSelection(
  selection: ChangesetDraftSelection | null | undefined,
): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const path of selection?.include ?? []) map.set(path, true);
  for (const path of selection?.exclude ?? []) map.set(path, false);
  return map;
}

/**
 * Override map → persisted selection dispositions ([P02]): deltas against
 * the default rule only — an override that matches the default (or names a
 * file no longer in the snapshot) drops out, so the persisted row never
 * accretes stale paths.
 */
export function selectionFromOverrides(
  snapshot: ChangesRouteSnapshot,
  overrides: ReadonlyMap<string, boolean>,
): ChangesetDraftSelection {
  const defaults = new Map<string, boolean>();
  for (const file of snapshot.entry?.files ?? []) {
    defaults.set(file.path, sessionFileDefaultSelected(file));
  }
  for (const file of snapshot.unattributed) {
    if (!defaults.has(file.path)) defaults.set(file.path, false);
  }
  const include: string[] = [];
  const exclude: string[] = [];
  for (const [path, on] of overrides) {
    const def = defaults.get(path);
    if (def === undefined || on === def) continue;
    (on ? include : exclude).push(path);
  }
  include.sort();
  exclude.sort();
  return { include, exclude };
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
  // Unattributed files default OFF: no owner claims them, so including one
  // in a commit is an explicit per-file election — the card mirror of the
  // CLI's exit-3 refusal ([D112]; a default set never absorbs work the
  // session can't account for).
  for (const file of project.unattributed) {
    consider(file.path, false);
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
  /** One-shot: the persisted draft selection has seeded the override map. */
  private _selectionSeeded = false;
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
    this._maybeSeedSelection();
    this._unsubscribe =
      allStore !== null ? allStore.subscribe(() => this._recompute()) : () => {};
  }

  private _derive(): ChangesRouteSnapshot {
    const data = this._allStore?.getSnapshot() ?? EMPTY_SNAPSHOT;
    return deriveChangesRouteSnapshot(data, this._binding, this._overrides);
  }

  /**
   * Seed the override map from the entry's persisted draft selection
   * ([P02]) — once, the first time a draft carrying dispositions appears.
   * Local overrides made before the snapshot arrived win (the user's live
   * hand beats the stored echo); later snapshots never re-seed, so a
   * toggle-then-echo round-trip can't clobber newer local state.
   */
  private _maybeSeedSelection(): boolean {
    if (this._selectionSeeded) return false;
    const selection = this._snapshot.entry?.draft?.selection;
    if (selection === undefined) return false;
    this._selectionSeeded = true;
    if (this._overrides.size > 0) return false;
    const seeded = overridesFromSelection(selection);
    if (seeded.size === 0) return false;
    for (const [path, on] of seeded) this._overrides.set(path, on);
    this._snapshot = this._derive();
    return true;
  }

  private _recompute(): void {
    this._snapshot = this._derive();
    this._maybeSeedSelection();
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

  /** Override the default selection for a path. Persists the disposition
   *  deltas into the entry's draft immediately ([P02] — selection rides the
   *  draft, so it survives restart and reads machine-globally). */
  setSelected(path: string, on: boolean): void {
    this._overrides.set(path, on);
    // A human disposition decision: never let a later snapshot echo re-seed
    // over it.
    this._selectionSeeded = true;
    this._recompute();
    getChangesetDraftStore()?.setDraft(
      this.projectDir,
      this.draftOwnerKind,
      this.tugSessionId,
      { selection: selectionFromOverrides(this._snapshot, this._overrides) },
    );
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
    const files = this.selectedPaths();
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
