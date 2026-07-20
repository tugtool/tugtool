/**
 * `SessionChangesView` — the Changes view-route's working surface
 * ([P01]/[P05]). On the `±` route this rides the TugSheet `shade`
 * presentation over the live
 * transcript and shows the card's changed files: the session's attributed
 * files plus the project's
 * unattributed files as one selection set (the head selection the prompt
 * entry's composer commits, [P05]), per-file inline diffs, dash entries with
 * their own Join/Release affordance, the commit receipt, and the non-repo
 * git-init affordance.
 *
 * The file-row / dash-action / receipt pieces are ported from the Lens
 * Sessions section (`lens/sections/sessions-section.tsx`), adapted to read
 * selection + entry identity from the per-card `ChangesRouteController`
 * ([P07]) instead of the Lens's per-entry commit form. The Lens originals
 * stay live until the Lens is slimmed.
 *
 * Laws: [L02] the controller + verb/diff/join stores enter React through
 * `useSyncExternalStore`; [L06] no appearance state in React (the diff dot,
 * status tones, and hover affordances paint via CSS); [L11] the row
 * checkbox is a chain control whose `toggle` lands in the view's responder
 * form; [L26] per-file collapse is by unmount under a stable
 * `ToolBlockCollapseContext` provider.
 *
 * @module components/tugways/cards/session-changes/session-changes-view
 */

import "./session-changes-view.css";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CircleCheck,
  FileMinus,
  FilePenLine,
  FilePlus,
  FileSymlink,
  GitCommitHorizontal,
  PencilSparkles,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";

import { dispatchAction } from "@/action-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import { BlockChrome } from "@/components/tugways/blocks/block-chrome";
import { BlockStrip } from "@/components/tugways/blocks/block-strip";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
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
import {
  useChangesetCommit,
  useChangesetGitInit,
  useChangesetJoin,
  useChangesetRelease,
} from "@/lib/changeset-verb-store";
import { useChangesetJoinResolve } from "@/lib/changeset-join-store";
import type {
  ChangesetFile,
  DashChangesetEntry,
  ProjectChangeset,
  SessionChangesetEntry,
  UnattributedFile,
} from "@/lib/changeset-types";
import {
  draftDrifted,
  type ChangesRouteController,
} from "@/lib/changes-route-controller";
import {
  alsoOnProjectSummary,
  alsoSessionRows,
  releasePreflight,
} from "./changes-zones";
import { buildSessionRows } from "@/components/lens/sections/sessions-data-source";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import {
  getChangesetDraftStore,
  useChangesetDraft,
} from "@/lib/changeset-draft-store";
import {
  TugMessageEditor,
  type TugMessageEditorHandle,
} from "@/components/tugways/tug-message-editor";
import { TugConfirmPopover } from "@/components/tugways/tug-confirm-popover";
import type { CodeSessionStore } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Item model — one entry (session / unattributed / dash) the ported
// file-block and dash-action components consume. Reconstructed from the
// controller snapshot so the ported components need no reshaping.
// ---------------------------------------------------------------------------

type ChangesFileEntry =
  | { kind: "session"; id: string; project: ProjectChangeset; entry: SessionChangesetEntry }
  | { kind: "unattributed"; id: string; project: ProjectChangeset; files: UnattributedFile[] };

interface ChangesDashItem {
  kind: "dash";
  id: string;
  project: ProjectChangeset;
  entry: DashChangesetEntry;
}

type ChangesItem = ChangesFileEntry | ChangesDashItem;

/**
 * Hint on durable-mutation buttons disabled while a Claude turn runs. Viewing
 * changes mid-turn is free; commits, joins, releases, and git-init — anything
 * durable — wait for the turn to end.
 */
const TURN_GATE_HINT = "Unavailable while a turn is running";

// ---------------------------------------------------------------------------
// Status glyph + tone
// ---------------------------------------------------------------------------

function statusToneClass(gitStatus: string): string {
  if (gitStatus.startsWith("??")) return "session-changes-status-untracked";
  const letter = gitStatus.replace(/[.\s]/g, "").charAt(0);
  switch (letter) {
    case "A":
      return "session-changes-status-added";
    case "D":
      return "session-changes-status-deleted";
    case "R":
      return "session-changes-status-renamed";
    default:
      return "session-changes-status-modified";
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
function hasHeadDiff(gitStatus: string): boolean {
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
      <span className="session-changes-file-path" title={path}>
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
        className="session-changes-file-path session-changes-file-path--link"
        data-slot="session-changes-file-ref"
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

function PopOutDiffButton({
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
      data-testid="session-changes-diff-popout"
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
 *  diffable paths (head flavor), or the dash range for a dash. */
function entryDiffDescriptor(item: ChangesItem): DiffDescriptor | null {
  const root = item.project.project_dir;
  if (item.kind === "dash") {
    return {
      kind: "range",
      root,
      worktree: item.entry.worktree,
      base: item.entry.base,
      branch: item.entry.owner_id,
    };
  }
  if (item.project.no_repo) return null;
  const files = item.kind === "unattributed" ? item.files : item.entry.files;
  const paths = files
    .filter((file) => hasHeadDiff(file.git_status))
    .map((file) => file.path);
  if (paths.length === 0) return null;
  return { kind: "head", root, paths };
}

/** The pop-out descriptor for one file (a dash file pops the whole range). */
function fileDiffDescriptor(
  item: ChangesItem,
  file: { path: string; git_status: string },
): DiffDescriptor | null {
  if (item.kind === "dash") return entryDiffDescriptor(item);
  if (item.project.no_repo || !hasHeadDiff(file.git_status)) return null;
  return { kind: "head", root: item.project.project_dir, paths: [file.path] };
}

/** The entry's inline diff store + snapshot — one `GitDiffStore` per entry. */
function useEntryDiff(item: ChangesItem): {
  snapshot: GitDiffSnapshot;
  ensureRequested: () => void;
} {
  const store = getEntryDiffStore(item.id);
  const descriptor = useMemo(() => entryDiffDescriptor(item), [item]);
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
      <p className="session-changes-file-block-notice" role="alert">
        {snapshot.error ?? "Couldn't load the diff."}
      </p>
    );
  }
  if (snapshot.phase === "loading" || snapshot.payload === null) {
    return (
      <p className="session-changes-file-block-notice" role="status">
        Loading diff…
      </p>
    );
  }
  const file = snapshot.payload.files.find((f) => f.path === path);
  if (file === undefined) {
    return (
      <p className="session-changes-file-block-notice" role="status">
        No diff for this file.
      </p>
    );
  }
  if (file.binary) {
    return (
      <p className="session-changes-file-block-notice" role="note">
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

interface FileBlockData {
  path: string;
  git_status: string;
  op: string;
  origin: string;
  shared: boolean;
  /** Bracket-hint provenance text ([P13]), when a bracket saw this path. */
  hint?: string;
}

function changesetFileData(file: ChangesetFile): FileBlockData {
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
    <span className="session-changes-file-identity">
      <span className={`session-changes-file-status ${statusToneClass(file.git_status)}`}>
        <StatusIcon gitStatus={file.git_status} />
      </span>
      <FilePathLink
        path={file.path}
        op={file.op}
        gitStatus={file.git_status}
        projectRoot={projectRoot}
      />
      {file.shared ? (
        <span className="session-changes-badge session-changes-badge-shared">
          shared
        </span>
      ) : null}
      {provenance !== null ? (
        <span className="session-changes-file-provenance">{provenance}</span>
      ) : null}
      {file.hint !== undefined ? (
        <span
          className="session-changes-file-hint"
          data-testid="session-changes-file-hint"
        >
          {file.hint}
        </span>
      ) : null}
    </span>
  );
}

function ChangesFileBlock({
  item,
  file,
  projectRoot,
  diffSnapshot,
  collapsed,
  onToggle,
}: {
  item: ChangesItem;
  file: FileBlockData;
  projectRoot: string;
  diffSnapshot: GitDiffSnapshot;
  collapsed: boolean;
  onToggle: (next: boolean) => void;
}) {
  const canDiff = item.kind === "dash" || hasHeadDiff(file.git_status);
  const diffFile = diffSnapshot.payload?.files.find((f) => f.path === file.path);
  const resultSummary: ToolResultSummary | undefined =
    diffFile !== undefined && !diffFile.binary
      ? { kind: "diff", added: diffFile.added, removed: diffFile.removed }
      : undefined;
  const popOut = fileDiffDescriptor(item, {
    path: file.path,
    git_status: file.git_status,
  });
  const handle = useMemo<ToolBlockCollapseHandle>(
    () => ({ collapsed, toggle: onToggle, toolUseId: `${item.id}|${file.path}` }),
    [collapsed, onToggle, item.id, file.path],
  );
  return (
    <ToolBlockCollapseContext.Provider value={handle}>
      <div
        className="session-changes-file-block"
        data-testid="session-changes-file-block"
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
// Entry file lists
// ---------------------------------------------------------------------------

/** The diffable file paths of an entry (dash rows share the range diff). */
function diffablePathsOf(item: ChangesFileEntry): string[] {
  const files: readonly { path: string; git_status: string }[] =
    item.kind === "unattributed" ? item.files : item.entry.files;
  return files.filter((f) => hasHeadDiff(f.git_status)).map((f) => f.path);
}

/** The view-level expand key for one file of one entry. */
function fileExpandKey(entryId: string, path: string): string {
  return `${entryId}|${path}`;
}

/**
 * A session/unattributed entry's file list with commit-selection checkboxes
 * and per-file diff expansion (eager `git diff` on mount for the `+N −M`
 * badges). Collapse state is CONTROLLED from the view (`expandedKeys`) so the
 * Expand All / Collapse All / Diff controls can live once in the Shade banner
 * and act across every entry; this component only fetches + renders.
 */
function ChangesEntryFiles({
  item,
  expandedKeys,
  onToggleFile,
  ownSessionId,
}: {
  item: ChangesFileEntry;
  expandedKeys: ReadonlySet<string>;
  onToggleFile: (entryId: string, path: string, collapsed: boolean) => void;
  /** The card session's id — distinguishes own vs foreign bracket hints ([P13]). */
  ownSessionId?: string;
}) {
  const projectRoot = item.project.project_dir;
  const { snapshot: diffSnapshot, ensureRequested } = useEntryDiff(item);
  useEffect(() => {
    ensureRequested();
  }, [ensureRequested]);
  // Drop this entry's inline-diff store on unmount (targeted, so a sibling
  // card's stores are untouched — unlike the Lens's global sweep).
  useEffect(() => () => releaseEntryDiffStore(item.id), [item.id]);

  const files =
    item.kind === "unattributed"
      ? item.files.map((file) => unattributedFileData(file, ownSessionId))
      : item.entry.files.map(changesetFileData);

  return (
    <div className="session-changes-file-list">
      {files.map((file) => (
        <ChangesFileBlock
          key={file.path}
          item={item}
          file={file}
          projectRoot={projectRoot}
          diffSnapshot={diffSnapshot}
          collapsed={!expandedKeys.has(fileExpandKey(item.id, file.path))}
          onToggle={(next) => onToggleFile(item.id, file.path, next)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dash entry: read-only file list + Join / Release / resolve
// ---------------------------------------------------------------------------

function DashActions({
  item,
  turnInProgress,
}: {
  item: ChangesDashItem;
  turnInProgress: boolean;
}) {
  const entryKey = item.id;
  const projectRoot = item.project.project_dir;
  const dashName = item.entry.display_name;
  const base = item.entry.base;

  const join = useChangesetJoin(entryKey);
  const resolve = useChangesetJoinResolve(projectRoot, dashName);
  const release = useChangesetRelease(entryKey);
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  // What releasing would destroy — shapes the confirm ([P14]).
  const preflight = releasePreflight(item.entry);

  useEffect(() => {
    if (join.phase === "done") resolve.clear();
  }, [join.phase, resolve]);

  if (resolve.phase === "resolving") {
    return (
      <div className="session-changes-dash-resolve" data-testid="session-changes-dash-resolving">
        <div className="session-changes-dash-resolve-head">Resolving conflicts…</div>
        {resolve.progress.map((p) => (
          <div key={p.path} className="session-changes-dash-resolve-file">
            <span className="session-changes-dash-resolve-path">{p.path}</span>
            <span className="session-changes-dash-resolve-rung">
              {p.rung} · {p.status}
            </span>
            {p.text.length > 0 ? (
              <pre className="session-changes-dash-resolve-stream">{p.text}</pre>
            ) : null}
          </div>
        ))}
      </div>
    );
  }
  if (resolve.phase === "resolved") {
    return (
      <div className="session-changes-dash-actions" data-testid="session-changes-dash-resolved">
        <div className="session-changes-dash-resolve-summary">
          Resolved {resolve.resolved.length} file
          {resolve.resolved.length === 1 ? "" : "s"}
          {resolve.shape === "replay" ? " (replayed rounds)" : ""}:
        </div>
        <ul className="session-changes-dash-resolved-list">
          {resolve.resolved.map((r) => (
            <li key={r.path}>
              <span className="session-changes-dash-resolve-path">{r.path}</span>
              <span className="session-changes-dash-rung-badge">{r.resolvedBy}</span>
            </li>
          ))}
        </ul>
        {join.phase === "pending" ? (
          <div className="session-changes-dash-working">Joining…</div>
        ) : (
          <div className="session-changes-dash-action-row">
            <TugPushButton
              size="sm"
              emphasis="outlined"
              role="accent"
              disabled={resolve.candidateCommit === null || turnInProgress}
              title={turnInProgress ? TURN_GATE_HINT : undefined}
              widthStabilize={{ alternateLabel: "Joining…" }}
              onClick={() =>
                resolve.candidateCommit !== null &&
                join.join(projectRoot, dashName, {
                  preview: false,
                  candidate: resolve.candidateCommit,
                })
              }
              data-testid="session-changes-dash-join-candidate"
            >
              Join
            </TugPushButton>
            <TugPushButton
              size="sm"
              emphasis="ghost"
              role="action"
              onClick={() => resolve.clear()}
            >
              Cancel
            </TugPushButton>
          </div>
        )}
      </div>
    );
  }
  if (resolve.phase === "partial") {
    return (
      <div className="session-changes-dash-actions" data-testid="session-changes-dash-partial">
        <div className="session-changes-dash-resolve-summary">
          Resolved {resolve.resolved.length}; {resolve.unresolved.length} still
          conflicting:
        </div>
        <ul className="session-changes-dash-conflict-list">
          {resolve.unresolved.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="session-changes-dash-hint">
          Resolve the rest in the dash worktree, then Join again.
        </div>
        <TugPushButton
          size="sm"
          emphasis="ghost"
          role="action"
          onClick={() => resolve.clear()}
        >
          Dismiss
        </TugPushButton>
      </div>
    );
  }
  if (resolve.phase === "error") {
    return (
      <div className="session-changes-dash-actions">
        <div className="session-changes-dash-error">Resolve failed: {resolve.error}</div>
        <TugPushButton
          size="sm"
          emphasis="ghost"
          role="action"
          onClick={() => resolve.clear()}
        >
          Dismiss
        </TugPushButton>
      </div>
    );
  }

  if (join.phase === "pending") {
    return <div className="session-changes-dash-working">Working…</div>;
  }
  if (join.phase === "preview" && join.conflicts.length === 0) {
    return (
      <div className="session-changes-dash-actions" data-testid="session-changes-dash-preview-clean">
        <div className="session-changes-dash-preview-msg">Joins cleanly into {base}.</div>
        <div className="session-changes-dash-action-row">
          <TugPushButton
            size="sm"
            emphasis="outlined"
            role="accent"
            disabled={turnInProgress}
            title={turnInProgress ? TURN_GATE_HINT : undefined}
            widthStabilize={{ alternateLabel: "Joining…" }}
            onClick={() => join.join(projectRoot, dashName, { preview: false })}
            data-testid="session-changes-dash-confirm-join"
          >
            Confirm join
          </TugPushButton>
          <TugPushButton size="sm" emphasis="ghost" role="action" onClick={() => join.clear()}>
            Cancel
          </TugPushButton>
        </div>
      </div>
    );
  }
  if (
    (join.phase === "preview" || join.phase === "conflict") &&
    join.conflicts.length > 0
  ) {
    return (
      <div className="session-changes-dash-actions" data-testid="session-changes-dash-preview-conflicts">
        <div className="session-changes-dash-preview-msg">
          Conflicts in {join.conflicts.length} file
          {join.conflicts.length === 1 ? "" : "s"}:
        </div>
        <ul className="session-changes-dash-conflict-list">
          {join.conflicts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="session-changes-dash-action-row">
          <TugPushButton
            size="sm"
            emphasis="outlined"
            role="accent"
            disabled={turnInProgress}
            title={turnInProgress ? TURN_GATE_HINT : undefined}
            onClick={() => resolve.resolve()}
            data-testid="session-changes-dash-resolve"
          >
            Resolve conflicts
          </TugPushButton>
          <TugPushButton size="sm" emphasis="ghost" role="action" onClick={() => join.clear()}>
            Cancel
          </TugPushButton>
        </div>
      </div>
    );
  }
  if (join.phase === "error") {
    return (
      <div className="session-changes-dash-actions">
        <div className="session-changes-dash-error">Join failed: {join.error}</div>
        <TugPushButton size="sm" emphasis="ghost" role="action" onClick={() => join.clear()}>
          Dismiss
        </TugPushButton>
      </div>
    );
  }
  if (join.phase === "done") {
    return null;
  }

  return (
    <div className="session-changes-dash-actions" data-testid="session-changes-dash-idle">
      <div className="session-changes-dash-action-row">
        <TugPushButton
          size="sm"
          emphasis="outlined"
          role="accent"
          onClick={() => join.join(projectRoot, dashName, { preview: true })}
          data-testid="session-changes-dash-join"
        >
          Join
        </TugPushButton>
        {!confirmingRelease ? (
          <TugPushButton
            size="sm"
            emphasis="ghost"
            role="action"
            disabled={turnInProgress}
            title={turnInProgress ? TURN_GATE_HINT : undefined}
            onClick={() => setConfirmingRelease(true)}
            data-testid="session-changes-dash-release"
          >
            Release
          </TugPushButton>
        ) : null}
      </div>
      {confirmingRelease ? (
        <div
          className="session-changes-release-preflight"
          data-testid="session-changes-release-preflight"
        >
          {preflight.kind === "discard" ? (
            <>
              <div className="session-changes-release-summary">
                Releasing discards {preflight.rounds} round
                {preflight.rounds === 1 ? "" : "s"}
                {preflight.dirty ? " · a dirty worktree" : ""}.
              </div>
              {preflight.subjects.length > 0 ? (
                <ul className="session-changes-release-subjects">
                  {preflight.subjects.map((subject, i) => (
                    <li key={`${i}-${subject}`}>{subject}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          <div className="session-changes-dash-action-row">
            <TugPushButton
              size="sm"
              emphasis="outlined"
              role="danger"
              disabled={release.phase === "pending" || turnInProgress}
              title={turnInProgress ? TURN_GATE_HINT : undefined}
              widthStabilize={{ alternateLabel: "Discarding…" }}
              onClick={() => {
                release.release(projectRoot, dashName);
                setConfirmingRelease(false);
              }}
              data-testid="session-changes-dash-release-confirm"
            >
              Discard dash
            </TugPushButton>
            <TugPushButton
              size="sm"
              emphasis="ghost"
              role="action"
              onClick={() => setConfirmingRelease(false)}
            >
              Keep
            </TugPushButton>
          </div>
        </div>
      ) : null}
      {release.phase === "error" ? (
        <div className="session-changes-dash-error">Release failed: {release.error}</div>
      ) : null}
    </div>
  );
}

/** A dash entry: its range files (read-only, no checkbox) + the dash actions. */
function ChangesDashEntry({
  item,
  turnInProgress,
}: {
  item: ChangesDashItem;
  turnInProgress: boolean;
}) {
  const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(new Set());
  const { snapshot: diffSnapshot, ensureRequested } = useEntryDiff(item);
  useEffect(() => {
    ensureRequested();
  }, [ensureRequested]);
  useEffect(() => () => releaseEntryDiffStore(item.id), [item.id]);

  const toggleFile = useCallback((path: string, nextCollapsed: boolean) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (nextCollapsed) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const files = item.entry.files;
  const dirty = item.entry.worktree_dirty ? " · dirty worktree" : "";
  return (
    <div
      className="session-changes-file-list"
      data-testid="session-changes-dash"
      data-dash={item.entry.owner_id}
    >
      <div className="session-changes-entry-heading">
        ⌁ {item.entry.display_name}
        <span className="session-changes-entry-heading-context">
          {item.entry.base} · {item.entry.rounds} round
          {item.entry.rounds === 1 ? "" : "s"}
          {dirty}
        </span>
      </div>
      {files.length === 0 ? (
        <div className="session-changes-clean" role="status">
          <CircleCheck size={14} />
          No files past base
        </div>
      ) : (
        files.map((file) => (
          <ChangesFileBlock
            key={file.path}
            item={item}
            file={changesetFileData(file)}
            projectRoot={item.project.project_dir}
            diffSnapshot={diffSnapshot}
            collapsed={!expandedFiles.has(file.path)}
            onToggle={(next) => toggleFile(file.path, next)}
          />
        ))
      )}
      <DashActions item={item} turnInProgress={turnInProgress} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commit receipt + non-repo
// ---------------------------------------------------------------------------

function CommitReceipt({
  sha,
  receipt,
  onDismiss,
}: {
  sha: string | null;
  receipt: string;
  onDismiss: () => void;
}) {
  return (
    <div className="session-changes-commit-receipt" data-testid="session-changes-commit-receipt">
      <div className="session-changes-commit-receipt-head">
        <span>Committed {sha === null ? "" : sha.slice(0, 10)}</span>
        <TugPushButton
          size="2xs"
          emphasis="ghost"
          role="action"
          onClick={onDismiss}
          data-testid="session-changes-commit-receipt-dismiss"
        >
          Dismiss
        </TugPushButton>
      </div>
      <pre className="session-changes-commit-receipt-body">{receipt}</pre>
    </div>
  );
}

function NonRepoBody({
  projectDir,
  turnInProgress,
}: {
  projectDir: string;
  turnInProgress: boolean;
}) {
  const { phase, error, init } = useChangesetGitInit(projectDir);
  return (
    <div className="session-changes-non-repo" role="group" data-testid="session-changes-non-repo">
      <div className="session-changes-non-repo-message">
        This directory is not a git repository.
      </div>
      <TugPushButton
        emphasis="outlined"
        role="accent"
        onClick={init}
        disabled={phase === "pending" || turnInProgress}
        title={turnInProgress ? TURN_GATE_HINT : undefined}
        data-testid="session-changes-git-init"
      >
        Initialize git
      </TugPushButton>
      {phase === "error" && error !== null ? (
        <div className="session-changes-non-repo-error">{error}</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** Debounce for persisting composer edits into the draft (Spec S01). */
const DRAFT_EDIT_DEBOUNCE_MS = 300;

/**
 * Zone 1's draft composer ([P02]/[P10]): the entry's persisted draft message
 * in a `TugMessageEditor` — the composer IS the display; the message is
 * never rendered read-only elsewhere. Streamed generation lands via
 * `restoreState` (programmatic — never reads as a user edit, the [P28]
 * contract); user edits debounce-persist through `changeset_draft_set` with
 * the `edited` pin ([P03]). The AI draft button is the one explicit overwrite
 * path — confirmed via `TugConfirmPopover` when the draft is edited — and it,
 * like typing, stays live mid-turn (drafting mutates nothing). Only the
 * Commit button lands, so only it idle-gates ([P08]).
 */
function DraftComposer({
  controller,
  entry,
  turnInProgress,
  canCommit,
  onCommit,
}: {
  controller: ChangesRouteController;
  entry: SessionChangesetEntry | null;
  turnInProgress: boolean;
  /** Whether this session has committable files and no commit is in flight. */
  canCommit: boolean;
  /** Land the composer's message as this session's commit ([P04]). */
  onCommit: (message: string) => void;
}): React.ReactElement {
  const projectDir = controller.projectDir;
  const ownerId = controller.tugSessionId;
  const overlay = useChangesetDraft(projectDir, "session", ownerId);
  const editorRef = useRef<TugMessageEditorHandle | null>(null);

  const persisted = entry?.draft?.message ?? "";
  const edited = entry?.draft?.edited === true;
  const drifted = draftDrifted(entry);
  // Whether the composer currently holds a non-blank message — gates the
  // Commit button. Tracked as state (not a ref read) so the button's
  // enabled-ness updates as the user types or a draft seeds in.
  const [hasText, setHasText] = useState(() => persisted.trim().length > 0);

  // The editor owns the document ([L02] editor-owned zone); these refs
  // mirror what we know is in it — `doc` tracks the current text (user
  // edits + programmatic seeds), `lastSeeded` the last programmatic seed.
  // A snapshot sync only lands when the doc is unsynced-edit-free
  // (`doc === lastSeeded`), so a server echo can never eat local typing.
  const docRef = useRef(persisted);
  const lastSeededRef = useRef(persisted);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Streamed generation fills the composer live (programmatic restore).
  useEffect(() => {
    if (overlay.phase !== "drafting") return;
    if (overlay.text === docRef.current) return;
    editorRef.current?.restoreState(overlay.text);
    docRef.current = overlay.text;
    lastSeededRef.current = overlay.text;
    setHasText(overlay.text.trim().length > 0);
  }, [overlay.phase, overlay.text]);

  // Persisted-message sync: a skill-authored draft (via the probe) or a
  // finished regeneration seeds in — only while the field holds no
  // unsynced user edits.
  useEffect(() => {
    if (overlay.phase === "drafting") return;
    if (persisted === docRef.current) return;
    if (docRef.current !== lastSeededRef.current) return;
    editorRef.current?.restoreState(persisted);
    docRef.current = persisted;
    lastSeededRef.current = persisted;
    setHasText(persisted.trim().length > 0);
  }, [persisted, overlay.phase]);

  const persistEdit = useCallback((): void => {
    debounceRef.current = null;
    getChangesetDraftStore()?.setDraft(projectDir, "session", ownerId, {
      message: docRef.current,
      edited: true,
    });
  }, [projectDir, ownerId]);

  const handleChange = useCallback(
    (text: string): void => {
      docRef.current = text;
      setHasText(text.trim().length > 0);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(persistEdit, DRAFT_EDIT_DEBOUNCE_MS);
    },
    [persistEdit],
  );

  // Unmount with a pending debounce: flush, never drop the user's words.
  useEffect(
    () => () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        persistEdit();
      }
    },
    [persistEdit],
  );

  // The AI draft button — the only machine-overwrite path ([P03]); an edited
  // draft interposes an inline confirm before the force. The confirm anchors
  // to the button's own element (captured via the row ref) so a keyboard
  // activation confirms identically to a click.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const draftRowRef = useRef<HTMLDivElement | null>(null);
  const regenerate = useCallback((): void => {
    controller.requestDraft(true);
  }, [controller]);
  const generating = overlay.phase === "drafting";

  return (
    <div className="session-changes-draft" data-slot="session-changes-draft">
      <TugMessageEditor
        ref={editorRef}
        value={persisted}
        onChange={handleChange}
        placeholder="Write a commit message or use the button to generate one."
        lineWrap
        aria-label="Draft commit message"
        data-testid="session-changes-draft-composer"
        className="session-changes-draft-editor"
      />
      <div className="session-changes-draft-row" ref={draftRowRef}>
        {overlay.phase === "error" ? (
          <span className="session-changes-draft-note" role="status">
            {overlay.detail ?? "draft failed"}
          </span>
        ) : drifted ? (
          <span className="session-changes-draft-note" role="status">
            changes moved since this draft
          </span>
        ) : (
          <span />
        )}
        <TugPushButton
          subtype="icon"
          icon={<PencilSparkles size={14} />}
          size="xs"
          emphasis="ghost"
          role="action"
          disabled={generating}
          title="Generate a commit message"
          aria-label="Generate a commit message"
          data-testid="session-changes-draft-regenerate"
          onClick={() => {
            if (edited) setConfirmOpen(true);
            else regenerate();
          }}
        />
        <TugPushButton
          size="xs"
          emphasis="outlined"
          role="accent"
          disabled={turnInProgress || !canCommit || !hasText}
          title={turnInProgress ? TURN_GATE_HINT : undefined}
          widthStabilize={{ alternateLabel: "Committing…" }}
          data-testid="session-changes-commit"
          onClick={() => onCommit(docRef.current)}
        >
          Commit
        </TugPushButton>
        <TugConfirmPopover
          open={confirmOpen}
          anchorEl={
            draftRowRef.current?.querySelector<HTMLElement>(
              '[data-testid="session-changes-draft-regenerate"]',
            ) ?? draftRowRef.current
          }
          message="Replace your edited message with a regenerated draft?"
          confirmLabel="Regenerate"
          confirmRole="action"
          onConfirm={() => {
            setConfirmOpen(false);
            regenerate();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
    </div>
  );
}

export interface SessionChangesViewProps {
  /** Repo-relative project directory the card is bound to. */
  projectDir: string | null;
  /** The per-card Changes controller — commit/draft state ([P07]). */
  changesController: ChangesRouteController;
  /**
   * The card's Claude session store — read for the turn-in-progress signal
   * that gates the DURABLE verbs (commit, join, release, git-init) while a
   * turn runs. Viewing changes and drafting mid-turn is free; only durable
   * mutations wait.
   */
  codeSessionStore: CodeSessionStore;
  /** Land this session's changeset with the given message ([P04]). */
  onCommit: (message: string) => void;
  /** Hide the Shade — the header's close affordance ([P05]). */
  onClose?: () => void;
}

export function SessionChangesView({
  projectDir,
  changesController,
  codeSessionStore,
  onCommit,
  onClose,
}: SessionChangesViewProps): React.ReactElement {
  const snap = useSyncExternalStore(
    changesController.subscribe,
    changesController.getSnapshot,
  );
  const commit = useChangesetCommit(changesController.entryKey);
  const project = snap.project;
  // `canInterrupt` is true exactly while a turn can be stopped (one is
  // running), so it is the turn-in-progress signal ([L02]).
  const turnInProgress = useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().canInterrupt === true,
  );

  // This session's changeset commits as one unit ([P05]) — no per-file
  // election. The file rows are read-only; unattributed files are shown for
  // awareness but never in this session's commit.
  const sessionFiles = snap.entry?.files ?? [];

  // Per-file collapse state is owned HERE (view scope), keyed by
  // `${entryId}|${path}`, so the Expand All / Collapse All / Diff controls
  // live once in the Shade banner and act across every head entry.
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());
  const onToggleFile = useCallback(
    (entryId: string, path: string, collapsed: boolean) => {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        const key = fileExpandKey(entryId, path);
        if (collapsed) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [],
  );

  // The Shade header is the Lens section band chrome ([P02]) — a `BlockStrip`
  // at `altitude="section"`, grip-less: the Changes glyph + title on the left,
  // the fold-all cue + Diff pop-out on the right.
  const buildHeader = (actions?: React.ReactNode): React.ReactElement => (
    <BlockStrip
      altitude="section"
      className="tool-call-header"
      dataTestid="session-changes-header"
      leading={
        <span className="tool-call-header-leading" aria-hidden="true">
          <GitCommitHorizontal size={14} />
        </span>
      }
      name="Changes"
      actions={
        <>
          {actions}
          {onClose !== undefined ? (
            <TugIconButton
              icon={<X size={12} strokeWidth={2.5} />}
              aria-label="Close"
              size="2xs"
              emphasis="ghost"
              onClick={onClose}
            />
          ) : null}
        </>
      }
    />
  );
  // The view fills the sheet's shade body ([P17]): the header strip pinned
  // above, the scrolling view below. The shade panel (geometry, scrim,
  // grabber, modality, Escape close) is `TugSheetContent
  // presentation="shade"` — mounted by the Session card around this view.
  const shell = (
    children: React.ReactNode,
    actions?: React.ReactNode,
  ): React.ReactElement => (
    <>
      <div className="tug-sheet-shade-header">{buildHeader(actions)}</div>
      <div
        className="session-changes-view"
        data-slot="session-changes-view"
        data-tug-focus="refuse"
      >
        {children}
      </div>
    </>
  );

  if (project.no_repo) {
    return shell(
      <NonRepoBody
        projectDir={projectDir ?? project.project_dir}
        turnInProgress={turnInProgress}
      />,
    );
  }

  const sessionItem: ChangesFileEntry | null =
    snap.entry !== null
      ? { kind: "session", id: changesController.entryKey, project, entry: snap.entry }
      : null;
  const unattributedItem: ChangesFileEntry | null =
    snap.unattributed.length > 0
      ? {
          kind: "unattributed",
          id: `unattributed:${project.project_dir}`,
          project,
          files: snap.unattributed,
        }
      : null;
  const hasSessionFiles = sessionFiles.length > 0;
  // Zone 1 emptiness is this-session-scoped ([P06]): Zone 2's dashes and
  // other sessions never make this session read as having work.
  const zone1Empty = !hasSessionFiles && unattributedItem === null;
  const showReceipt = commit.phase === "done" && commit.receipt !== null;

  // The head entries (session + unattributed) the banner controls act on —
  // dashes keep their own range diff + read-only lists, so they are not in
  // the combined set. Every diffable file across them yields one expand key;
  // the whole-view Diff pop-out is a `head` diff over their union of paths.
  const headEntries: ChangesFileEntry[] = [
    ...(sessionItem !== null && hasSessionFiles ? [sessionItem] : []),
    ...(unattributedItem !== null ? [unattributedItem] : []),
  ];
  const combinedKeys: string[] = headEntries.flatMap((entry) =>
    diffablePathsOf(entry).map((path) => fileExpandKey(entry.id, path)),
  );
  const combinedDiffPaths: string[] = headEntries.flatMap((entry) =>
    diffablePathsOf(entry),
  );
  const combinedDescriptor: DiffDescriptor | null =
    combinedDiffPaths.length > 0
      ? { kind: "head", root: project.project_dir, paths: combinedDiffPaths }
      : null;

  // Fold-all cue: the standard section chevron, but it expands / collapses
  // ALL files rather than accordioning the header. `allExpanded` derives the
  // chevron direction; the toggle sets the whole key set at once.
  const allExpanded =
    combinedKeys.length > 0 && combinedKeys.every((k) => expandedKeys.has(k));
  const headerActions =
    combinedKeys.length > 1 || combinedDescriptor !== null ? (
      <>
        {combinedKeys.length > 1 ? (
          <BlockFoldCue
            collapsed={!allExpanded}
            onToggle={(nextCollapsed) =>
              setExpandedKeys(nextCollapsed ? new Set() : new Set(combinedKeys))
            }
            collapsedLabel="Expand all"
            expandedLabel="Collapse all"
            ariaLabelExpand="Expand all files"
            ariaLabelCollapse="Collapse all files"
            size="xs"
            subtype="icon"
            stabilizeScroll={false}
            data-slot="session-changes-fold-all"
          />
        ) : null}
        {combinedDescriptor !== null ? (
          <PopOutDiffButton
            descriptor={combinedDescriptor}
            label="Open the whole diff in a card"
          />
        ) : null}
      </>
    ) : undefined;

  return shell(
    <div className="session-changes-view-body">
      {zone1Empty && !showReceipt ? (
        <div className="session-changes-clean" role="status">
          <CircleCheck size={14} />
          No changes
        </div>
      ) : null}
      {showReceipt ? (
        <CommitReceipt
          sha={commit.sha}
          receipt={commit.receipt as string}
          onDismiss={commit.clear}
        />
      ) : null}
      {!zone1Empty || snap.entry?.draft !== undefined ? (
        <DraftComposer
          controller={changesController}
          entry={snap.entry}
          turnInProgress={turnInProgress}
          canCommit={hasSessionFiles && commit.phase !== "pending"}
          onCommit={onCommit}
        />
      ) : null}
      {sessionItem !== null && hasSessionFiles ? (
        <ChangesEntryFiles
          item={sessionItem}
          expandedKeys={expandedKeys}
          onToggleFile={onToggleFile}
        />
      ) : null}
      {unattributedItem !== null ? (
        <>
          <div
            className="session-changes-section-label"
            data-slot="session-changes-unattributed-label"
          >
            unattributed — no session claims these
          </div>
          <ChangesEntryFiles
            item={unattributedItem}
            expandedKeys={expandedKeys}
            onToggleFile={onToggleFile}
            ownSessionId={changesController.tugSessionId}
          />
        </>
      ) : null}
      <AlsoOnProject
        project={project}
        ownOwnerId={changesController.tugSessionId}
        dashes={snap.dashes}
        turnInProgress={turnInProgress}
      />
    </div>,
    headerActions,
  );
}

/**
 * Zone 2 — "Also on this project" ([P06]): every other owner's work on this
 * checkout, collapsed by default to one summary line. Expanding shows one
 * row per owner: session rows named by display name with the
 * `focus-session-card` jump (the exact affordance the Lens Sessions section
 * uses; unlinked when no open card resolves, [Q02]) and dash lanes in dash
 * grammar with their Join/Release affordances. Renders nothing when no
 * other owner has work — the shade stays purely this-session.
 */
function AlsoOnProject({
  project,
  ownOwnerId,
  dashes,
  turnInProgress,
}: {
  project: ProjectChangeset;
  ownOwnerId: string;
  dashes: DashChangesetEntry[];
  turnInProgress: boolean;
}): React.ReactElement | null {
  // Collapsed/expanded is per-card, non-durable view state ([L19]).
  const [expanded, setExpanded] = useState(false);
  // The session→card mapping reuses the Lens's binding source ([P06]).
  const bindings = useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    cardSessionBindingStore.getSnapshot,
  );
  const sessions = alsoSessionRows(project, ownOwnerId);
  const summary = alsoOnProjectSummary(sessions, dashes);
  if (summary === null) return null;

  const cardIdFor = (sessionId: string): string | null => {
    for (const row of buildSessionRows(bindings)) {
      if (row.tugSessionId === sessionId) return row.cardId;
    }
    return null;
  };

  return (
    <div className="session-changes-zone2" data-slot="session-changes-zone2">
      <button
        type="button"
        className="session-changes-zone2-line"
        data-tug-focus="refuse"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        data-testid="session-changes-also-line"
      >
        {summary}
      </button>
      {expanded ? (
        <div className="session-changes-zone2-body">
          {sessions.map((row) => {
            const cardId = cardIdFor(row.ownerId);
            return (
              <div
                key={row.ownerId}
                className="session-changes-zone2-session"
                data-testid="session-changes-zone2-session"
              >
                {cardId !== null ? (
                  <button
                    type="button"
                    className="session-changes-zone2-jump"
                    data-tug-focus="refuse"
                    title="Front this session's card"
                    onClick={() =>
                      dispatchAction({ action: "focus-session-card", cardId })
                    }
                  >
                    {row.displayName}
                  </button>
                ) : (
                  <span className="session-changes-zone2-name">
                    {row.displayName}
                  </span>
                )}
                <span className="session-changes-zone2-meta">
                  {row.fileCount} file{row.fileCount === 1 ? "" : "s"}
                  {row.live ? " · live" : ""}
                </span>
              </div>
            );
          })}
          {dashes.map((entry) => (
            <ChangesDashEntry
              key={entry.owner_id}
              item={{
                kind: "dash",
                id: `dash:${project.project_dir}:${entry.owner_id}`,
                project,
                entry,
              }}
              turnInProgress={turnInProgress}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
