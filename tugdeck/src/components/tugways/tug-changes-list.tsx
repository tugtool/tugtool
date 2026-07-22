/**
 * `TugChangesList` — a read-only list of changed files with inline diffs
 * ([P01], Spec S01). One `TugListRow` per file (compact, mono): a status
 * glyph + path (with an open/reveal context menu), the house `+N −M` badge
 * pair, a pop-out-to-a-card diff affordance, and a fold cue, over a diff
 * body that expands and collapses in place. Every row is expandable —
 * untracked files diff via the backend's synthesized new-file diffs.
 *
 * Two diff sources share the row renderer:
 *  - the live list (`TugChangesList`) diffs the working tree (`head`
 *    flavor, eagerly fetched so the ± badges fill in), and
 *  - the `/commit` receipt (`CommitChangesList`) diffs one committed sha
 *    (`commit` flavor, fetched lazily per row on first expand — the counts
 *    are frozen in the receipt record, so nothing loads until you look).
 *
 * The component owns diff fetching — one `GitDiffStore` per entry / per
 * expanded receipt row, dropped on unmount — and nothing else: live
 * per-file collapse is CONTROLLED by the host (`expandedKeys` +
 * `onToggleFile`) so each host keeps its own fold-all / whole-diff chrome.
 *
 * Laws: [L02] diff stores enter React through `useSyncExternalStore`;
 * [L06] status tones and hover affordances paint via CSS, never React
 * state; [L26] the diff body collapses by unmount.
 *
 * @module components/tugways/tug-changes-list
 */

import "./tug-changes-list.css";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { SquareArrowOutUpRight } from "lucide-react";

import { dispatchAction } from "@/action-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import { DiffSummaryBadges } from "@/components/tugways/blocks/diff-summary-badges";
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
  OrphanedFile,
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
  | { kind: "unattributed"; id: string; project: ProjectChangeset; files: UnattributedFile[] }
  | { kind: "orphaned"; id: string; project: ProjectChangeset; files: OrphanedFile[] };

// ---------------------------------------------------------------------------
// Status mark — a colored single letter (more legible than a glyph at this
// size): green N (new), yellow M (modified or moved), red D (deleted).
// ---------------------------------------------------------------------------

/** The status letter + tone for a file. New folds untracked + added; modified
 *  folds renamed/moved and every other change; deleted stands alone. */
function statusMark(gitStatus: string): { letter: "N" | "M" | "D"; toneClass: string } {
  if (gitStatus.startsWith("??")) {
    return { letter: "N", toneClass: "tug-changes-list-status-new" };
  }
  const code = gitStatus.replace(/[.\s]/g, "").charAt(0);
  switch (code) {
    case "A":
      return { letter: "N", toneClass: "tug-changes-list-status-new" };
    case "D":
      return { letter: "D", toneClass: "tug-changes-list-status-deleted" };
    default:
      // Modified, renamed/moved, copied, type-changed — all read as "changed".
      return { letter: "M", toneClass: "tug-changes-list-status-modified" };
  }
}

/** The status letter, colored by tone. Decorative — the git status also rides
 *  the row's provenance text and title. */
function StatusMark({ gitStatus }: { gitStatus: string }): React.ReactElement {
  const { letter, toneClass } = statusMark(gitStatus);
  return (
    <span
      className={`tug-changes-list-file-status ${toneClass}`}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

function isDeleted(op: string, gitStatus: string): boolean {
  return op === "deleted" || /D/.test(gitStatus);
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
      // Opening the file is the link's own gesture — never also the row's
      // expand toggle.
      event.stopPropagation();
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
      onClick={(event) => {
        event?.stopPropagation();
        dispatchAction({ action: TUG_ACTIONS.OPEN_DIFF, descriptor });
      }}
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

/** The whole-entry diff descriptor: `git diff HEAD` (untracked included)
 *  scoped to the entry's paths. Null for a non-repo project or an empty
 *  entry. */
export function entryDiffDescriptor(entry: TugChangesListEntry): DiffDescriptor | null {
  if (entry.project.no_repo) return null;
  const files = entry.kind === "session" ? entry.entry.files : entry.files;
  const paths = files.map((file) => file.path);
  if (paths.length === 0) return null;
  return { kind: "head", root: entry.project.project_dir, paths };
}

/** The pop-out descriptor for one file (`git diff HEAD` scoped to it). */
function filePopOutDescriptor(
  project: ProjectChangeset,
  path: string,
): DiffDescriptor | null {
  if (project.no_repo) return null;
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

/** One file's diff as the row's expanded body. */
function fileBlockBody(snapshot: GitDiffSnapshot, path: string): React.ReactNode {
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
// File rows
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

/**
 * Orphaned row data ([D120]): a file stranded on a dead session, shown with an
 * `orphaned from <prior owner>` hint so the reclaim reads as adoption. Keeps
 * the dead owner's op/origin provenance.
 */
function orphanedFileData(file: OrphanedFile): FileBlockData {
  return {
    path: file.path,
    git_status: file.git_status,
    op: file.op,
    origin: file.origin,
    shared: false,
    hint: `orphaned from ${file.prior_owner_name}`,
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
 * One file's row + expandable diff body, shared by the live list and the
 * `/commit` receipt: a compact mono `TugListRow` (status glyph leading; path
 * + badges content; ± counts, pop-out, and fold cue trailing) over a
 * mount-on-expand diff body ([L26]). The whole row is a click target for the
 * fold; the path link and trailing controls own their gestures and stop
 * propagation. Presentation carries no lifecycle dot — a changed file has no
 * lifecycle.
 */
export function ChangesFileRow({
  file,
  projectRoot,
  counts,
  expanded,
  onToggle,
  popOut,
  body,
  onClaim,
}: {
  file: FileBlockData;
  projectRoot: string;
  /** The `+N −M` pair when known (live: from the eager entry diff; receipt:
   *  from the frozen record). Absent → no badges (binary, still loading). */
  counts: { added: number; removed: number } | null;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  popOut: DiffDescriptor | null;
  /** The expanded body. Rendered only while `expanded`. */
  body: React.ReactNode;
  /** When set, a Claim affordance leads the trailing cluster — the row's
   *  file is unattributed-but-likely and this session can claim it ([D1xx]). */
  onClaim?: () => void;
}): React.ReactElement {
  return (
    <div
      className="tug-changes-list-file-block"
      data-testid="tug-changes-list-file-block"
      data-path={file.path}
      data-expanded={expanded ? "true" : undefined}
    >
      <div
        className="tug-changes-list-row-hit"
        onClick={() => onToggle(!expanded)}
      >
        <TugListRow
          variant="flush"
          density="compact"
          mono
          leading={<StatusMark gitStatus={file.git_status} />}
          trailing={
            <span
              className="tug-changes-list-row-trailing"
              onClick={(event) => event.stopPropagation()}
            >
              {onClaim !== undefined ? (
                <TugPushButton
                  className="tug-changes-list-claim"
                  size="2xs"
                  emphasis="outlined"
                  role="accent"
                  title="Claim this file for this session"
                  aria-label={`Claim ${file.path} for this session`}
                  data-testid="tug-changes-list-claim"
                  onClick={(event) => {
                    event?.stopPropagation();
                    onClaim();
                  }}
                >
                  Claim
                </TugPushButton>
              ) : null}
              {counts !== null ? (
                <DiffSummaryBadges added={counts.added} removed={counts.removed} />
              ) : null}
              {popOut !== null ? (
                <PopOutDiffButton
                  descriptor={popOut}
                  label={`Open diff for ${file.path} in a card`}
                />
              ) : null}
              <BlockFoldCue
                collapsed={!expanded}
                onToggle={(nextCollapsed) => onToggle(!nextCollapsed)}
                collapsedLabel="Expand diff"
                ariaLabelExpand={`Show diff for ${file.path}`}
                ariaLabelCollapse={`Hide diff for ${file.path}`}
                size="2xs"
                subtype="icon"
                stabilizeScroll={false}
                data-slot="tug-changes-list-fold"
              />
            </span>
          }
        >
          <FileIdentity file={file} projectRoot={projectRoot} />
        </TugListRow>
      </div>
      {expanded ? (
        <div className="tug-changes-list-file-diff" data-slot="tug-changes-list-file-diff">
          {body}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry file lists + host helpers
// ---------------------------------------------------------------------------

/** The file paths of an entry (host builds fold-all key sets). Every file is
 *  diffable — untracked files arrive as synthesized new-file diffs. */
export function diffablePathsOf(entry: TugChangesListEntry): string[] {
  const files: readonly { path: string }[] =
    entry.kind === "session" ? entry.entry.files : entry.files;
  return files.map((f) => f.path);
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
  onClaim,
}: {
  entry: TugChangesListEntry;
  expandedKeys: ReadonlySet<string>;
  onToggleFile: (entryId: string, path: string, collapsed: boolean) => void;
  /** The card session's id — distinguishes own vs foreign bracket hints ([P13]). */
  ownSessionId?: string;
  /** Per-path claim, wired only for the unattributed entry. */
  onClaim?: (path: string) => void;
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
    entry.kind === "session"
      ? entry.entry.files.map(changesetFileData)
      : entry.kind === "orphaned"
        ? entry.files.map(orphanedFileData)
        : entry.files.map((file) => unattributedFileData(file, ownSessionId));

  return (
    <div className="tug-changes-list-file-list">
      {files.map((file) => {
        const diffFile = diffSnapshot.payload?.files.find((f) => f.path === file.path);
        const counts =
          diffFile !== undefined && !diffFile.binary
            ? { added: diffFile.added, removed: diffFile.removed }
            : null;
        const expanded = expandedKeys.has(fileExpandKey(entry.id, file.path));
        return (
          <ChangesFileRow
            key={file.path}
            file={file}
            projectRoot={projectRoot}
            counts={counts}
            expanded={expanded}
            onToggle={(next) => onToggleFile(entry.id, file.path, !next)}
            popOut={filePopOutDescriptor(entry.project, file.path)}
            body={expanded ? fileBlockBody(diffSnapshot, file.path) : null}
            onClaim={onClaim !== undefined ? () => onClaim(file.path) : undefined}
          />
        );
      })}
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
  /** When set, unattributed rows show a Claim affordance that promotes the
   *  path into this session's changeset ([D1xx]). */
  onClaimUnattributed?: (path: string) => void;
  /** Optional label rendered above the orphaned entry ([D120]). */
  orphanedLabel?: string;
  /** When set, orphaned rows show a Claim affordance that reclaims the path
   *  into this session, severing the dead originator ([D120]). */
  onClaimOrphaned?: (path: string) => void;
  className?: string;
}

export function TugChangesList({
  entries,
  ownSessionId,
  expandedKeys,
  onToggleFile,
  unattributedLabel,
  onClaimUnattributed,
  orphanedLabel,
  onClaimOrphaned,
  className,
}: TugChangesListProps): React.ReactElement {
  return (
    <div
      className={className !== undefined ? `tug-changes-list ${className}` : "tug-changes-list"}
      data-slot="tug-changes-list"
    >
      {entries.map((entry) => {
        const label =
          entry.kind === "unattributed"
            ? unattributedLabel
            : entry.kind === "orphaned"
              ? orphanedLabel
              : undefined;
        const onClaim =
          entry.kind === "unattributed"
            ? onClaimUnattributed
            : entry.kind === "orphaned"
              ? onClaimOrphaned
              : undefined;
        return (
          <React.Fragment key={entry.id}>
            {label !== undefined ? (
              <div
                className="tug-changes-list-section-label"
                data-slot={`tug-changes-list-${entry.kind}-label`}
              >
                {label}
              </div>
            ) : null}
            <EntryFiles
              entry={entry}
              expandedKeys={expandedKeys}
              onToggleFile={onToggleFile}
              ownSessionId={entry.kind === "unattributed" ? ownSessionId : undefined}
              onClaim={onClaim}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commit list — the `/commit` receipt's file rows ([P08])
// ---------------------------------------------------------------------------

/** One committed file frozen in a `/commit` receipt: path, git name-status
 *  word (`modified` | `created` | `deleted` | `renamed`), ± counts. */
export interface CommitChangesFile {
  path: string;
  status: string;
  added: number;
  removed: number;
}

/** Map a name-status word to a synthetic porcelain code the glyph / tone
 *  helpers key on. */
function commitStatusToGitCode(status: string): string {
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
 * One receipt row's lazy commit diff: nothing is fetched until the row first
 * expands, then a per-row `GitDiffStore` runs the `commit` flavor scoped to
 * this path. The store is keyed by sha + path (commit diffs are immutable,
 * so a re-expand reuses the ready snapshot) and dropped on unmount.
 */
function CommitFileRow({
  root,
  sha,
  file,
}: {
  root: string;
  sha: string;
  file: CommitChangesFile;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const storeId = `commit:${sha}:${file.path}`;
  const descriptor = useMemo<DiffDescriptor>(
    () => ({ kind: "commit", root, sha, paths: [file.path] }),
    [root, sha, file.path],
  );
  const { snapshot, ensureRequested } = useEntryDiff(storeId, descriptor);
  useEffect(() => {
    if (expanded) ensureRequested();
  }, [expanded, ensureRequested]);
  useEffect(() => () => releaseEntryDiffStore(storeId), [storeId]);

  const gitStatus = commitStatusToGitCode(file.status);
  return (
    <ChangesFileRow
      file={{
        path: file.path,
        git_status: gitStatus,
        // A committed file renders no op/origin provenance — the receipt
        // header already carries the commit identity.
        op: file.status === "deleted" ? "deleted" : "",
        origin: "",
        shared: false,
      }}
      projectRoot={root}
      counts={{ added: file.added, removed: file.removed }}
      expanded={expanded}
      onToggle={setExpanded}
      popOut={descriptor}
      body={expanded ? fileBlockBody(snapshot, file.path) : null}
    />
  );
}

/**
 * The committed files of one `/commit` receipt as the same rows as
 * {@link TugChangesList} — sha-backed instead of working-tree-backed
 * ([P08]). Counts render instantly from the frozen record; each row's diff
 * fetches lazily on first expand (a thousand-file commit costs nothing until
 * you look). A vanished sha (rebase, gc) degrades to an in-body notice while
 * the rows stay intact.
 */
export function CommitChangesList({
  root,
  sha,
  files,
}: {
  /** The project dir the commit lives in (resolves the workspace). */
  root: string;
  /** The commit's full sha, parsed from the receipt record. */
  sha: string;
  files: readonly CommitChangesFile[];
}): React.ReactElement {
  return (
    <div className="tug-changes-list-file-list" data-slot="tug-commit-changes-list">
      {files.map((file) => (
        <CommitFileRow key={file.path} root={root} sha={sha} file={file} />
      ))}
    </div>
  );
}
