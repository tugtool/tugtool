/**
 * `SessionChangesView` — the Changes view-route's working surface
 * ([P01]/[P05]). On the `±` route this rides a TugShade over the live
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
import { CircleCheck, SquareArrowOutUpRight } from "lucide-react";

import { dispatchAction } from "@/action-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { useResponderForm } from "@/components/tugways/use-responder-form";
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
import type { ChangesRouteController } from "@/lib/changes-route-controller";
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

function statusGlyph(gitStatus: string): string {
  return gitStatus.replace(/\./g, " ");
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

function FileSelectCheckbox({
  path,
  senderId,
  selected,
  disabled,
}: {
  path: string;
  senderId: string;
  selected: boolean;
  disabled: boolean;
}) {
  return (
    <TugCheckbox
      size="sm"
      checked={selected}
      senderId={senderId}
      disabled={disabled}
      aria-label={`Include ${path} in the commit`}
      data-testid="session-changes-file-select"
      data-path={path}
    />
  );
}

interface RowSelection {
  senderId: string;
  selected: boolean;
  disabled: boolean;
}

interface FileBlockData {
  path: string;
  git_status: string;
  op: string;
  origin: string;
  ambiguous: boolean;
  shared: boolean;
}

function changesetFileData(file: ChangesetFile): FileBlockData {
  return {
    path: file.path,
    git_status: file.git_status,
    op: file.op,
    origin: file.origin,
    ambiguous: file.ambiguous === true,
    shared: file.shared === true,
  };
}

function unattributedFileData(file: UnattributedFile): FileBlockData {
  return {
    path: file.path,
    git_status: file.git_status,
    op: "",
    origin: "",
    ambiguous: false,
    shared: false,
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
        {statusGlyph(file.git_status)}
      </span>
      <FilePathLink
        path={file.path}
        op={file.op}
        gitStatus={file.git_status}
        projectRoot={projectRoot}
      />
      {file.ambiguous ? (
        <span className="session-changes-badge session-changes-badge-ambiguous">
          ambiguous
        </span>
      ) : null}
      {file.shared ? (
        <span className="session-changes-badge session-changes-badge-shared">
          shared
        </span>
      ) : null}
      {provenance !== null ? (
        <span className="session-changes-file-provenance">{provenance}</span>
      ) : null}
    </span>
  );
}

function ChangesFileBlock({
  item,
  file,
  projectRoot,
  selection,
  diffSnapshot,
  collapsed,
  onToggle,
}: {
  item: ChangesItem;
  file: FileBlockData;
  projectRoot: string;
  selection?: RowSelection;
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
          leading={
            selection !== undefined ? (
              <FileSelectCheckbox
                path={file.path}
                senderId={selection.senderId}
                selected={selection.selected}
                disabled={selection.disabled}
              />
            ) : undefined
          }
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

/**
 * A session/unattributed entry's file list with commit-selection checkboxes,
 * per-file diff expansion (eager `git diff` on mount for the `+N −M` badges),
 * and Expand/Collapse All + whole-entry pop-out.
 */
function ChangesEntryFiles({
  item,
  rowSelection,
}: {
  item: ChangesFileEntry;
  rowSelection: (path: string) => RowSelection;
}) {
  const projectRoot = item.project.project_dir;
  const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(new Set());
  const { snapshot: diffSnapshot, ensureRequested } = useEntryDiff(item);
  const entryDescriptor = useMemo(() => entryDiffDescriptor(item), [item]);
  useEffect(() => {
    ensureRequested();
  }, [ensureRequested]);
  // Drop this entry's inline-diff store on unmount (targeted, so a sibling
  // card's stores are untouched — unlike the Lens's global sweep).
  useEffect(() => () => releaseEntryDiffStore(item.id), [item.id]);

  const toggleFile = useCallback((path: string, nextCollapsed: boolean) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (nextCollapsed) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const files =
    item.kind === "unattributed"
      ? item.files.map(unattributedFileData)
      : item.entry.files.map(changesetFileData);
  const diffablePaths = diffablePathsOf(item);

  return (
    <div className="session-changes-file-list">
      {files.map((file) => (
        <ChangesFileBlock
          key={file.path}
          item={item}
          file={file}
          projectRoot={projectRoot}
          selection={rowSelection(file.path)}
          diffSnapshot={diffSnapshot}
          collapsed={!expandedFiles.has(file.path)}
          onToggle={(next) => toggleFile(file.path, next)}
        />
      ))}
      {entryDescriptor !== null && diffablePaths.length > 0 ? (
        <div className="session-changes-entry-actions">
          {diffablePaths.length > 1 ? (
            <>
              <TugPushButton
                emphasis="ghost"
                role="action"
                size="2xs"
                onClick={() => setExpandedFiles(new Set(diffablePaths))}
                data-testid="session-changes-expand-all"
              >
                Expand All
              </TugPushButton>
              <TugPushButton
                emphasis="ghost"
                role="action"
                size="2xs"
                onClick={() => setExpandedFiles(new Set())}
                data-testid="session-changes-collapse-all"
              >
                Collapse All
              </TugPushButton>
            </>
          ) : null}
          <PopOutDiffButton
            descriptor={entryDescriptor}
            label="Open the whole diff in a card"
          />
        </div>
      ) : null}
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
        {confirmingRelease ? (
          <>
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
          </>
        ) : (
          <TugPushButton
            size="sm"
            emphasis="ghost"
            role="action"
            onClick={() => setConfirmingRelease(true)}
            data-testid="session-changes-dash-release"
          >
            Release
          </TugPushButton>
        )}
      </div>
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

export interface SessionChangesViewProps {
  /** Repo-relative project directory the card is bound to. */
  projectDir: string | null;
  /** The per-card Changes controller — selection + commit/draft state ([P07]). */
  changesController: ChangesRouteController;
  /**
   * The card's Claude session store — read for the turn-in-progress signal
   * that gates the DURABLE verbs (join, release, git-init) while a turn runs.
   * Viewing changes mid-turn is free; only durable mutations wait.
   */
  codeSessionStore: CodeSessionStore;
}

export function SessionChangesView({
  projectDir,
  changesController,
  codeSessionStore,
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

  // The head selection ([P05]): the session's attributed files plus the
  // project's unattributed files, one selection set. Each row's checkbox is a
  // chain control ([L11]) whose `toggle` handler here writes the controller's
  // override; `selected` reads back from the controller snapshot.
  const sessionFiles = snap.entry?.files ?? [];
  const entryKey = changesController.entryKey;
  const selectSender = (path: string): string => `${entryKey}|${path}`;
  const toggleHandlers = useMemo(() => {
    const map: Record<string, (checked: boolean) => void> = {};
    const add = (path: string): void => {
      map[`${entryKey}|${path}`] = (checked) =>
        changesController.setSelected(path, checked);
    };
    for (const file of sessionFiles) add(file.path);
    for (const file of snap.unattributed) add(file.path);
    return map;
  }, [entryKey, sessionFiles, snap.unattributed, changesController]);
  const { ResponderScope, responderRef } = useResponderForm({ toggle: toggleHandlers });

  const commitPending = commit.phase === "pending";
  const rowSelection = (path: string): RowSelection => ({
    senderId: selectSender(path),
    selected: snap.selectedPaths.has(path),
    disabled: commitPending,
  });

  if (project.no_repo) {
    return (
      <div
        className="session-changes-view"
        data-slot="session-changes-view"
        data-tug-focus="refuse"
      >
        <NonRepoBody
          projectDir={projectDir ?? project.project_dir}
          turnInProgress={turnInProgress}
        />
      </div>
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
  const empty =
    !hasSessionFiles && unattributedItem === null && snap.dashes.length === 0;
  const showReceipt = commit.phase === "done" && commit.receipt !== null;

  return (
    <div
      className="session-changes-view"
      data-slot="session-changes-view"
      data-tug-focus="refuse"
    >
      <ResponderScope>
        <div
          ref={responderRef as (el: HTMLDivElement | null) => void}
          className="session-changes-view-body"
        >
          {empty && !showReceipt ? (
            <div className="session-changes-clean" role="status">
              <CircleCheck size={14} />
              No changes from this session
            </div>
          ) : null}
          {showReceipt ? (
            <CommitReceipt
              sha={commit.sha}
              receipt={commit.receipt as string}
              onDismiss={commit.clear}
            />
          ) : null}
          {sessionItem !== null && hasSessionFiles ? (
            <ChangesEntryFiles item={sessionItem} rowSelection={rowSelection} />
          ) : null}
          {unattributedItem !== null ? (
            <ChangesEntryFiles item={unattributedItem} rowSelection={rowSelection} />
          ) : null}
          {snap.dashes.map((entry) => (
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
      </ResponderScope>
    </div>
  );
}
