/**
 * Changeset feed wire types — TS mirror of `tugcast-core/src/types.rs`.
 *
 * The per-workspace `ChangesetSnapshot` / `ChangesetEntry` / `ChangesetFile`
 * ride the CHANGESET feed (0x23); the account-global aggregate
 * `WorkspacesChangesetSnapshot` / `ProjectChangeset` ride the CHANGESET_ALL
 * feed (0x24).
 *
 * The Rust definitions are authoritative; both sides deserialize the shared
 * golden fixtures `src/__tests__/fixtures/changeset-snapshot.golden.json` and
 * `src/__tests__/fixtures/workspaces-changeset-snapshot.golden.json`, so drift
 * on either side fails a test.
 *
 * @module lib/changeset-types
 */

/** One file inside a changeset entry. */
export interface ChangesetFile {
  /** Path relative to the repository root. */
  path: string;
  /** Porcelain-v2 XY status (working tree) or name-status letter (dash). */
  git_status: string;
  /** Attribution operation: write | edit | notebook | created | modified | deleted | renamed. */
  op: string;
  /** Attribution origin: exact | bash | replay | dash. */
  origin: string;
  /** True when a concurrent session's Bash bracket overlapped this file. */
  ambiguous: boolean;
  /** True when more than one changeset owns this file. */
  shared: boolean;
  /** Epoch milliseconds of the most recent attribution event for this file. */
  last_touched: number;
}

/** A dirty file no owner claims (hand edits, detached background writes). */
export interface UnattributedFile {
  path: string;
  git_status: string;
}

/** Files attributed to one Claude session. */
export interface SessionChangesetEntry {
  kind: "session";
  /** The tug session id that owns these files. */
  owner_id: string;
  /** Session display name (name when user-set, else the id hash). */
  display_name: string;
  /** True when the session has a live relay right now. */
  live: boolean;
  files: ChangesetFile[];
}

/** A dash worktree branch and its accumulated base..branch changes. */
export interface DashChangesetEntry {
  kind: "dash";
  /** The dash branch ref name (e.g. `tugdash/fix-join`). */
  owner_id: string;
  /** The dash's short name (branch name without the `tugdash/` prefix). */
  display_name: string;
  /** The base branch the dash was created from. */
  base: string;
  /** Number of commits on the dash branch past its base. */
  rounds: number;
  /** Worktree path relative to the repository root. */
  worktree: string;
  /** True when the dash worktree has uncommitted changes. */
  worktree_dirty: boolean;
  files: ChangesetFile[];
}

export type ChangesetEntry = SessionChangesetEntry | DashChangesetEntry;

/** The workspace-scoped changeset snapshot (CHANGESET feed, 0x23). */
export interface ChangesetSnapshot {
  /** Canonical key of the workspace the snapshot was computed in. */
  workspace_key: string;
  /** Current branch name, or "(detached)" if HEAD is detached. */
  branch: string;
  /** Number of commits ahead of upstream. */
  ahead: number;
  /** Number of commits behind upstream. */
  behind: number;
  /** SHA of HEAD commit. */
  head_sha: string;
  /** Subject line of HEAD commit. */
  head_message: string;
  /** One entry per owner (session or dash) with attributed files. */
  changesets: ChangesetEntry[];
  /** Dirty files no owner claims. */
  unattributed: UnattributedFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isChangesetFile(value: unknown): value is ChangesetFile {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.git_status === "string" &&
    typeof value.op === "string" &&
    typeof value.origin === "string" &&
    typeof value.ambiguous === "boolean" &&
    typeof value.shared === "boolean" &&
    typeof value.last_touched === "number"
  );
}

export function isUnattributedFile(value: unknown): value is UnattributedFile {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.git_status === "string"
  );
}

export function isChangesetEntry(value: unknown): value is ChangesetEntry {
  if (
    !isRecord(value) ||
    typeof value.owner_id !== "string" ||
    typeof value.display_name !== "string" ||
    !Array.isArray(value.files) ||
    !value.files.every(isChangesetFile)
  ) {
    return false;
  }
  if (value.kind === "session") {
    return typeof value.live === "boolean";
  }
  if (value.kind === "dash") {
    return (
      typeof value.base === "string" &&
      typeof value.rounds === "number" &&
      typeof value.worktree === "string" &&
      typeof value.worktree_dirty === "boolean"
    );
  }
  return false;
}

export function isChangesetSnapshot(value: unknown): value is ChangesetSnapshot {
  return (
    isRecord(value) &&
    typeof value.workspace_key === "string" &&
    typeof value.branch === "string" &&
    typeof value.ahead === "number" &&
    typeof value.behind === "number" &&
    typeof value.head_sha === "string" &&
    typeof value.head_message === "string" &&
    Array.isArray(value.changesets) &&
    value.changesets.every(isChangesetEntry) &&
    Array.isArray(value.unattributed) &&
    value.unattributed.every(isUnattributedFile)
  );
}

/**
 * One project's slice of the account-global aggregate snapshot.
 *
 * Extends {@link ChangesetSnapshot} (the per-project payload is flattened on
 * the wire — Spec S06) with the project's identity. When `no_repo` is true the
 * project dir is not a git working tree: the snapshot fields are empty/zero
 * and the card renders an "Initialize git" affordance.
 */
export interface ProjectChangeset extends ChangesetSnapshot {
  /** Absolute checkout root; also the base for the card's clickable links. */
  project_dir: string;
  /** Basename of `project_dir`, shown as the section title. */
  display_name: string;
  /** True when `project_dir` is not inside a git working tree. */
  no_repo: boolean;
}

/** The account-global aggregate changeset snapshot (CHANGESET_ALL feed, 0x24). */
export interface WorkspacesChangesetSnapshot {
  /** One entry per open project, in registry-enumeration order. */
  projects: ProjectChangeset[];
}

export function isProjectChangeset(value: unknown): value is ProjectChangeset {
  return (
    isRecord(value) &&
    typeof value.project_dir === "string" &&
    typeof value.display_name === "string" &&
    typeof value.no_repo === "boolean" &&
    isChangesetSnapshot(value)
  );
}

export function isWorkspacesChangesetSnapshot(
  value: unknown,
): value is WorkspacesChangesetSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.projects) &&
    value.projects.every(isProjectChangeset)
  );
}
