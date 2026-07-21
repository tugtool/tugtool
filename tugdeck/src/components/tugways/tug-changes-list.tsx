/**
 * `TugChangesList` — a read-only list of changed files with inline diffs
 * ([P01], Spec S01). One block per file: a status glyph + path (with an
 * open/reveal context menu), a `+N −M` badge, and a pop-out-to-a-card diff
 * affordance, over a `git diff HEAD` body that expands and collapses in place.
 *
 * Extracted from the Changes shade so both the read-only glance and the commit
 * route's rising sheet compose the same rows. The component owns diff
 * fetching — one `GitDiffStore` per entry, dropped on unmount — and nothing
 * else: per-file collapse is CONTROLLED by the host (`expandedKeys` +
 * `onToggleFile`) so each host keeps its own fold-all / whole-diff chrome.
 *
 * Laws: [L02] the per-entry diff store enters React through
 * `useSyncExternalStore`; [L06] status tones and hover affordances paint via
 * CSS, never React state; [L26] per-file collapse is by unmount under a stable
 * `ToolBlockCollapseContext` provider.
 *
 * @module components/tugways/tug-changes-list
 */

import "./tug-changes-list.css";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  FileMinus,
  FilePenLine,
  FilePlus,
  FileSymlink,
  SquareArrowOutUpRight,
} from "lucide-react";

import { dispatchAction } from "@/action-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import { BlockChrome } from "@/components/tugways/blocks/block-chrome";
import type { ToolResultSummary } from "@/components/tugways/blocks/tool-result-summary";
import {
  ToolBlockCollapseContext,
  type ToolBlockCollapseHandle,
} from "@/components/tugways/blocks/collapse-context";
import {
  getEntryDiffStore,
  releaseEntryDiffStore,
} from "@/lib/changeset-diff-store";
import {
  diffDescriptorKey,
  type DiffDescriptor,
  type GitDiffSnapshot,
} from "@/lib/git-diff-store";
import type {
  ChangesetFile,
  ProjectChangeset,
  SessionChangesetEntry,
  UnattributedFile,
} from "@/lib/changeset-types";

// ---------------------------------------------------------------------------
// Entry model — one head entry (the session's attributed files, or the
// project's unattributed files) the list renders. The dash lane lives in the
// Changes shade, not here ([P01]).
// ---------------------------------------------------------------------------

export type TugChangesListEntry =
  | { kind: "session"; id: string; project: ProjectChangeset; entry: SessionChangesetEntry }
  | { kind: "unattributed"; id: string; project: ProjectChangeset; files: UnattributedFile[] };

// ---------------------------------------------------------------------------
// Status glyph + tone
// ---------------------------------------------------------------------------

function statusToneClass(gitStatus: string): string {
  if (gitStatus.startsWith("??")) return "tug-changes-list-status-untracked";
  const letter = gitStatus.replace(/[.\s]/g, "").charAt(0);
  switch (letter) {
    case "A":
      return "tug-changes-list-status-added";
    case "D":
      return "tug-changes-list-status-deleted";
    case "R":
      return "tug-changes-list-status-renamed";
    default:
      return "tug-changes-list-status-modified";
  }
}

/** The lucide status icon for a file, keyed by op — semantic, not the raw
 *  porcelain code. Colored by {@link statusToneClass} on the wrapping span. */
function StatusIcon({ gitStatus }: { gitStatus: string }): React.ReactElement {
  if (gitStatus.startsWith("??")) return <FilePlus size={13} aria-hidden />;
  const letter = gitStatus.replace(/[.\s]/g, "").charAt(0);
  switch (letter) {
    case "A":
      return <FilePlus size={13} aria-hidden />;
    case "D":
      return <FileMinus size={13} aria-hidden />;
    case "R":
      return <FileSymlink size={13} aria-hidden />;
    default:
      return <FilePenLine size={13} aria-hidden />;
  }
}

function isDeleted(op: string, gitStatus: string): boolean {
  return op === "deleted" || /D/.test(gitStatus);
}

/** Whether a file has a `git diff HEAD` to show (untracked files do not). */
export function hasHeadDiff(gitStatus: string): boolean {
  return !gitStatus.startsWith("??");
}

// ---------------------------------------------------------------------------
// File path link + pop-out
// ---------------------------------------------------------------------------

function FilePathLink({
  path,
  op,
  gitStatus,
  projectRoot,
}: {
  path: string;
  op: string;
  gitStatus: string;
  projectRoot: string;
}) {
  const absolutePath = projectRoot ? `${projectRoot}/${path}` : path;

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.shiftKey) return;
      dispatchAction({ action: TUG_ACTIONS.OPEN_FILE, path: absolutePath });
    },
    [absolutePath],
  );

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    // Suppress WebKit's mousedown focus default so opening a file never pulls
    // first responder onto this read-only surface (the Text card claims focus
    // via its own activation path).
    if (event.button !== 0 || event.metaKey || event.shiftKey) return;
    event.preventDefault();
  }, []);

  if (isDeleted(op, gitStatus) || !projectRoot) {
    return (
      <span className="tug-changes-list-file-path" title={path}>
        {path}
      </span>
    );
  }

  return (
    <TugContextMenu<string>
      items={[
        { action: TUG_ACTIONS.OPEN_FILE, value: absolutePath, label: "Open in Editor" },
        { action: TUG_ACTIONS.REVEAL_IN_FINDER, value: absolutePath, label: "Show in Finder" },
      ]}
    >
      <span
        className="tug-changes-list-file-path tug-changes-list-file-path--link"
        data-slot="tug-changes-list-file-ref"
        title={path}
        data-tug-focus="refuse"
        data-no-activate=""
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      >
        {path}
      </span>
    </TugContextMenu>
  );
}

export function PopOutDiffButton({
  descriptor,
  label,
}: {
  descriptor: DiffDescriptor;
  label: string;
}) {
  return (
    <TugPushButton
      subtype="icon"
      icon={<SquareArrowOutUpRight size={12} />}
      size="2xs"
      emphasis="ghost"
      role="action"
      title="Open diff in a card"
      aria-label={label}
      data-testid="tug-changes-list-diff-popout"
      onClick={() => dispatchAction({ action: TUG_ACTIONS.OPEN_DIFF, descriptor })}
    />
  );
}

// ---------------------------------------------------------------------------
// Diff descriptors + inline diff sourcing
// ---------------------------------------------------------------------------

const DIFF_IDLE_SNAPSHOT: GitDiffSnapshot = {
  phase: "idle",
  requestId: null,
  payload: null,
  error: null,
};

const DIFF_NOOP_SUBSCRIBE = (): (() => void) => () => {};

/** The whole-entry diff descriptor: `git diff HEAD` scoped to the entry's
 *  diffable paths (head flavor). Null for a non-repo project or an entry with
 *  no diffable file. */
export function entryDiffDescriptor(entry: TugChangesListEntry): DiffDescriptor | null {
  if (entry.project.no_repo) return null;
  const files = entry.kind === "unattributed" ? entry.files : entry.entry.files;
  const paths = files
    .filter((file) => hasHeadDiff(file.git_status))
    .map((file) => file.path);
  if (paths.length === 0) return null;
  return { kind: "head", root: entry.project.project_dir, paths };
}

/** The pop-out descriptor for one file (`git diff HEAD` scoped to it). */
function filePopOutDescriptor(
  project: ProjectChangeset,
  gitStatus: string,
  path: string,
): DiffDescriptor | null {
  if (project.no_repo || !hasHeadDiff(gitStatus)) return null;
  return { kind: "head", root: project.project_dir, paths: [path] };
}

/** An entry's inline diff store + snapshot — one `GitDiffStore` per entry id,
 *  sourcing the descriptor the caller memoizes. */
export function useEntryDiff(
  id: string,
  descriptor: DiffDescriptor | null,
): {
  snapshot: GitDiffSnapshot;
  ensureRequested: () => void;
} {
  const store = getEntryDiffStore(id);
  const requestedKeyRef = useRef<string | null>(null);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? DIFF_NOOP_SUBSCRIBE,
    store?.getSnapshot ?? (() => DIFF_IDLE_SNAPSHOT),
  );
  const ensureRequested = useCallback(() => {
    if (store === null || descriptor === null) return;
    const key = diffDescriptorKey(descriptor);
    if (requestedKeyRef.current === key) return;
    requestedKeyRef.current = key;
    store.requestDiff(descriptor);
  }, [store, descriptor]);
  return { snapshot, ensureRequested };
}

/** One file's diff as the body of its block. */
function fileBlockBody(
  snapshot: GitDiffSnapshot,
  path: string,
  canDiff: boolean,
): React.ReactNode {
  if (!canDiff) return null;
  if (snapshot.phase === "error") {
    return (
      <p className="tug-changes-list-file-block-notice" role="alert">
        {snapshot.error ?? "Couldn't load the diff."}
      </p>
    );
  }
  if (snapshot.phase === "loading" || snapshot.payload === null) {
    return (
      <p className="tug-changes-list-file-block-notice" role="status">
        Loading diff…
      </p>
    );
  }
  const file = snapshot.payload.files.find((f) => f.path === path);
  if (file === undefined) {
    return (
      <p className="tug-changes-list-file-block-notice" role="status">
        No diff for this file.
      </p>
    );
  }
  if (file.binary) {
    return (
      <p className="tug-changes-list-file-block-notice" role="note">
        Binary file — no textual diff.
      </p>
    );
  }
  return (
    <DiffBlock
      data={{ source: "unified", text: file.unified, filePath: file.path }}
      embedded
    />
  );
}

// ---------------------------------------------------------------------------
// File blocks
// ---------------------------------------------------------------------------

export interface FileBlockData {
  path: string;
  git_status: string;
  op: string;
  origin: string;
  shared: boolean;
  /** Bracket-hint provenance text ([P13]), when a bracket saw this path. */
  hint?: string;
}

export function changesetFileData(file: ChangesetFile): FileBlockData {
  return {
    path: file.path,
    git_status: file.git_status,
    op: file.op,
    origin: file.origin,
    shared: file.shared === true,
  };
}

/**
 * Unattributed row data with its bracket-hint text ([P13]): the card
 * session's own hint reads as a terse `likely` badge — the one-glance
 * disposition cue; foreign hints render as a `seen by N` provenance count.
 */
function unattributedFileData(
  file: UnattributedFile,
  ownSessionId?: string,
): FileBlockData {
  const hintedBy = file.hinted_by ?? [];
  let hint: string | undefined;
  if (ownSessionId !== undefined && hintedBy.includes(ownSessionId)) {
    hint = "likely";
  } else if (hintedBy.length > 0) {
    hint = `seen by ${hintedBy.length}`;
  }
  return {
    path: file.path,
    git_status: file.git_status,
    op: "",
    origin: "",
    shared: false,
    hint,
  };
}

function FileIdentity({
  file,
  projectRoot,
}: {
  file: FileBlockData;
  projectRoot: string;
}) {
  const provenance =
    file.origin === ""
      ? null
      : file.origin === "dash"
        ? file.op
        : `${file.op} · ${file.origin}`;
  return (
    <span className="tug-changes-list-file-identity">
      <span className={`tug-changes-list-file-status ${statusToneClass(file.git_status)}`}>
        <StatusIcon gitStatus={file.git_status} />
      </span>
      <FilePathLink
        path={file.path}
        op={file.op}
        gitStatus={file.git_status}
        projectRoot={projectRoot}
      />
      {file.shared ? (
        <span className="tug-changes-list-badge tug-changes-list-badge-shared">
          shared
        </span>
      ) : null}
      {provenance !== null ? (
        <span className="tug-changes-list-file-provenance">{provenance}</span>
      ) : null}
      {file.hint !== undefined ? (
        <span
          className="tug-changes-list-file-hint"
          data-testid="tug-changes-list-file-hint"
        >
          {file.hint}
        </span>
      ) : null}
    </span>
  );
}

/**
 * One file's block: identity strip + `+N −M` badge + pop-out, over the inline
 * diff body. Dash-agnostic — the whole-diff `popOut` descriptor, the `canDiff`
 * flag, and the collapse `toolUseId` are supplied by the host so a dash file
 * (which pops the whole range) and a head file share this renderer.
 */
export function ChangesFileBlock({
  file,
  projectRoot,
  diffSnapshot,
  collapsed,
  onToggle,
  toolUseId,
  popOut,
  canDiff,
}: {
  file: FileBlockData;
  projectRoot: string;
  diffSnapshot: GitDiffSnapshot;
  collapsed: boolean;
  onToggle: (next: boolean) => void;
  toolUseId: string;
  popOut: DiffDescriptor | null;
  canDiff: boolean;
}) {
  const diffFile = diffSnapshot.payload?.files.find((f) => f.path === file.path);
  const resultSummary: ToolResultSummary | undefined =
    diffFile !== undefined && !diffFile.binary
      ? { kind: "diff", added: diffFile.added, removed: diffFile.removed }
      : undefined;
  const handle = useMemo<ToolBlockCollapseHandle>(
    () => ({ collapsed, toggle: onToggle, toolUseId }),
    [collapsed, onToggle, toolUseId],
  );
  return (
    <ToolBlockCollapseContext.Provider value={handle}>
      <div
        className="tug-changes-list-file-block"
        data-testid="tug-changes-list-file-block"
        data-path={file.path}
      >
        <BlockChrome
          variant="tool"
          phase="idle"
          identity={<FileIdentity file={file} projectRoot={projectRoot} />}
          resultSummary={resultSummary}
          headerActions={
            popOut !== null ? (
              <PopOutDiffButton
                descriptor={popOut}
                label={`Open diff for ${file.path} in a card`}
              />
            ) : undefined
          }
        >
          {fileBlockBody(diffSnapshot, file.path, canDiff)}
        </BlockChrome>
      </div>
    </ToolBlockCollapseContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Frozen list — a static, read-only file list for a durable record ([P08])
// ---------------------------------------------------------------------------

/** One committed file in a frozen list: path, git name-status word, ± counts. */
export interface FrozenChangesFile {
  path: string;
  /** `modified` | `created` | `deleted` | `renamed`. */
  status: string;
  added: number;
  removed: number;
}

/** Map a name-status word to a synthetic porcelain code the glyph / tone
 *  helpers key on. */
function frozenStatusToGitCode(status: string): string {
  switch (status) {
    case "created":
      return "A ";
    case "deleted":
      return "D ";
    case "renamed":
      return "R ";
    default:
      return " M";
  }
}

/**
 * A static, read-only file list for a durable record — a committed changeset
 * frozen into the `/commit` receipt ([P08]). Renders the same identity rows as
 * {@link TugChangesList} (status glyph + path + ± counts) reusing its CSS, but
 * with no live diff fetch, no store, and no expansion: the files are committed,
 * so there is nothing left to diff against the working tree.
 */
export function FrozenChangesList({
  files,
}: {
  files: readonly FrozenChangesFile[];
}): React.ReactElement {
  return (
    <div className="tug-changes-list-file-list tug-changes-list-frozen">
      {files.map((file) => {
        const gitStatus = frozenStatusToGitCode(file.status);
        return (
          <div key={file.path} className="tug-changes-list-frozen-row">
            <span className={`tug-changes-list-file-status ${statusToneClass(gitStatus)}`}>
              <StatusIcon gitStatus={gitStatus} />
            </span>
            <span className="tug-changes-list-file-path" title={file.path}>
              {file.path}
            </span>
            <span className="tug-changes-list-frozen-counts">
              <span className="tug-changes-list-status-added">{`+${file.added}`}</span>
              <span className="tug-changes-list-status-deleted">{`−${file.removed}`}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry file lists + host helpers
// ---------------------------------------------------------------------------

/** The diffable file paths of an entry (host builds fold-all key sets). */
export function diffablePathsOf(entry: TugChangesListEntry): string[] {
  const files: readonly { path: string; git_status: string }[] =
    entry.kind === "unattributed" ? entry.files : entry.entry.files;
  return files.filter((f) => hasHeadDiff(f.git_status)).map((f) => f.path);
}

/** The controlled expand key for one file of one entry. */
export function fileExpandKey(entryId: string, path: string): string {
  return `${entryId}|${path}`;
}

/**
 * One entry's file list with per-file diff expansion (eager `git diff` on
 * mount for the `+N −M` badges). Collapse state is CONTROLLED from the host
 * (`expandedKeys`) so the fold-all / whole-diff controls live once in the
 * host's chrome and act across every entry; this only fetches + renders.
 */
function EntryFiles({
  entry,
  expandedKeys,
  onToggleFile,
  ownSessionId,
}: {
  entry: TugChangesListEntry;
  expandedKeys: ReadonlySet<string>;
  onToggleFile: (entryId: string, path: string, collapsed: boolean) => void;
  /** The card session's id — distinguishes own vs foreign bracket hints ([P13]). */
  ownSessionId?: string;
}) {
  const projectRoot = entry.project.project_dir;
  const descriptor = useMemo(() => entryDiffDescriptor(entry), [entry]);
  const { snapshot: diffSnapshot, ensureRequested } = useEntryDiff(entry.id, descriptor);
  useEffect(() => {
    ensureRequested();
  }, [ensureRequested]);
  // Drop this entry's inline-diff store on unmount (targeted, so a sibling
  // card's stores are untouched).
  useEffect(() => () => releaseEntryDiffStore(entry.id), [entry.id]);

  const files =
    entry.kind === "unattributed"
      ? entry.files.map((file) => unattributedFileData(file, ownSessionId))
      : entry.entry.files.map(changesetFileData);

  return (
    <div className="tug-changes-list-file-list">
      {files.map((file) => (
        <ChangesFileBlock
          key={file.path}
          file={file}
          projectRoot={projectRoot}
          diffSnapshot={diffSnapshot}
          collapsed={!expandedKeys.has(fileExpandKey(entry.id, file.path))}
          onToggle={(next) => onToggleFile(entry.id, file.path, next)}
          toolUseId={fileExpandKey(entry.id, file.path)}
          popOut={filePopOutDescriptor(entry.project, file.git_status, file.path)}
          canDiff={hasHeadDiff(file.git_status)}
        />
      ))}
    </div>
  );
}

export interface TugChangesListProps {
  /** Head entries to render, in order: the session entry, then unattributed. */
  entries: ReadonlyArray<TugChangesListEntry>;
  /** The card session's id — distinguishes own vs foreign bracket hints on
   *  unattributed rows. */
  ownSessionId?: string;
  /** Controlled per-file expansion, keyed `${entryId}|${path}` (fileExpandKey). */
  expandedKeys: ReadonlySet<string>;
  onToggleFile: (entryId: string, path: string, collapsed: boolean) => void;
  /** Optional label rendered above the unattributed entry. */
  unattributedLabel?: string;
  className?: string;
}

export function TugChangesList({
  entries,
  ownSessionId,
  expandedKeys,
  onToggleFile,
  unattributedLabel,
  className,
}: TugChangesListProps): React.ReactElement {
  return (
    <div
      className={className !== undefined ? `tug-changes-list ${className}` : "tug-changes-list"}
      data-slot="tug-changes-list"
    >
      {entries.map((entry) => (
        <React.Fragment key={entry.id}>
          {entry.kind === "unattributed" && unattributedLabel !== undefined ? (
            <div
              className="tug-changes-list-section-label"
              data-slot="tug-changes-list-unattributed-label"
            >
              {unattributedLabel}
            </div>
          ) : null}
          <EntryFiles
            entry={entry}
            expandedKeys={expandedKeys}
            onToggleFile={onToggleFile}
            ownSessionId={entry.kind === "unattributed" ? ownSessionId : undefined}
          />
        </React.Fragment>
      ))}
    </div>
  );
}
