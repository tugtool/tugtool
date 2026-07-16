/**
 * Sessions section — the Lens `kind: "sessions"` registrant ([P07]): the
 * account-global view of every open session's dirty state as a reorderable/
 * collapsible Lens section, one entry per session plus per-project dash and
 * unattributed pseudo-entries. Supersedes the retired standalone changeset
 * card; the entry subtree (`EntryBody` and its blocks, the commit composer)
 * moved here verbatim.
 *
 * Renders the aggregate CHANGESET_ALL feed (0x24) joined against the open
 * dev cards (the card-session binding store). Each entry is a session bound
 * to an open dev card — the feed emits a (possibly fileless) entry for every
 * live session, titled by the chooser's rule (name → prompt snippet → id
 * prefix) — or a session with attributed dirty files, plus one entry per
 * dash worktree and an "Unattributed" entry per project with unclaimed dirty
 * files. Each entry is a `BlockChrome` section in one plain scroll — sticky
 * headers are the wayfinding; file rows carry a commit-selection checkbox, a
 * git-status glyph, op/origin provenance, ambiguous/shared badges, and a
 * scoped-diff affordance.
 * Session and unattributed entries host the commit flow ([P15]) — message
 * field, width-stabilized commit button, numstat receipt — and a session in
 * a non-git directory hosts the "Initialize git" affordance instead.
 *
 * Data arrives via `useChangesetAll()` — an app-level singleton store
 * (`FeedStore` over CHANGESET_ALL, no workspace filter), NOT `useCardData`:
 * the aggregate frame is account-global and `FeedStore` holds one value per
 * feed id, so aggregation is server-side. Clickable links use each project's
 * own `project_dir` as the absolute-path base.
 *
 * Entry collapse is card-local state: a set of collapsed entry ids feeding
 * per-entry `ToolBlockCollapseContext` providers around each entry's
 * `BlockChrome`. An entry a snapshot introduces renders open (a new id is
 * never in the collapsed set), and a user's collapse sticks across
 * recomputes because the set is keyed by id.
 *
 * Laws: [L02] external state via useSyncExternalStore, [L06] appearance via
 *       CSS, [L11] controls emit actions, [L20] composed children keep
 *       their own tokens.
 *
 * @module components/lens/sections/sessions-section
 */

import "./sessions-section.css";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CircleCheck, CircleDashed, GitBranch, SquareArrowOutUpRight } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import { dispatchAction } from "@/action-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { useTugSheet } from "@/components/tugways/tug-sheet";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import {
  TugMessageEditor,
  type TugMessageEditorHandle,
} from "@/components/tugways/tug-message-editor";
import { presentAlertSheet } from "@/components/tugways/tug-alert-sheet";
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances";
import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import { BlockChrome } from "@/components/tugways/blocks/block-chrome";
import type { ToolResultSummary } from "@/components/tugways/blocks/tool-result-summary";
import {
  ToolBlockCollapseContext,
  type ToolBlockCollapseHandle,
} from "@/components/tugways/blocks/collapse-context";
import { useChangesetAll } from "@/lib/changeset-all-store";
import {
  useChangesetCommit,
  useChangesetGitInit,
  useChangesetJoin,
  useChangesetRelease,
} from "@/lib/changeset-verb-store";
import { useChangesetDraft } from "@/lib/changeset-draft-store";
import { useChangesetJoinResolve } from "@/lib/changeset-join-store";
import {
  getEntryDiffStore,
  sweepEntryDiffStores,
} from "@/lib/changeset-diff-store";
import {
  diffDescriptorKey,
  type DiffDescriptor,
  type GitDiffFile,
  type GitDiffSnapshot,
} from "@/lib/git-diff-store";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import type {
  ChangesetDraft,
  ChangesetFile,
  DashChangesetEntry,
  ProjectChangeset,
  SessionChangesetEntry,
  UnattributedFile,
  WorkspacesChangesetSnapshot,
} from "@/lib/changeset-types";

// ---------------------------------------------------------------------------
// Entry model — one item per session (+ dash / unattributed pseudo-entries)
// ---------------------------------------------------------------------------

interface SessionItem {
  kind: "session";
  id: string;
  project: ProjectChangeset;
  entry: SessionChangesetEntry;
}

interface DashItem {
  kind: "dash";
  id: string;
  project: ProjectChangeset;
  entry: DashChangesetEntry;
}

interface UnattributedItem {
  kind: "unattributed";
  id: string;
  project: ProjectChangeset;
  files: UnattributedFile[];
}

type SectionItem = SessionItem | DashItem | UnattributedItem;

/**
 * Join the aggregate snapshot with the open dev cards. Projects narrow to
 * those with at least one bound card; within a project, session entries show
 * when they have files OR belong to a bound session (so every open session
 * gets a row, and a closed session's dirty files stay visible). A bound
 * session the feed hasn't emitted yet gets a synthesized fileless entry, so
 * a fresh card appears immediately. Dash entries always show; unattributed
 * files form one trailing pseudo-entry per project.
 */
function buildItems(
  data: WorkspacesChangesetSnapshot,
  bindings: ReadonlyMap<string, CardSessionBinding>,
): SectionItem[] {
  const workspaceKeys = new Set<string>();
  const boundSessionIds = new Set<string>();
  for (const binding of bindings.values()) {
    workspaceKeys.add(binding.workspaceKey);
    boundSessionIds.add(binding.tugSessionId);
  }

  const items: SectionItem[] = [];
  for (const project of data.projects) {
    if (!workspaceKeys.has(project.workspace_key)) continue;

    const seenSessions = new Set<string>();
    const dashes: DashItem[] = [];
    for (const entry of project.changesets) {
      if (entry.kind === "session") {
        seenSessions.add(entry.owner_id);
        if (entry.files.length === 0 && !boundSessionIds.has(entry.owner_id)) {
          continue;
        }
        items.push({
          kind: "session",
          id: `session:${entry.owner_id}`,
          project,
          entry,
        });
      } else {
        dashes.push({
          kind: "dash",
          id: `dash:${project.project_dir}:${entry.owner_id}`,
          project,
          entry,
        });
      }
    }
    for (const binding of bindings.values()) {
      if (
        binding.workspaceKey !== project.workspace_key ||
        seenSessions.has(binding.tugSessionId)
      ) {
        continue;
      }
      seenSessions.add(binding.tugSessionId);
      items.push({
        kind: "session",
        id: `session:${binding.tugSessionId}`,
        project,
        entry: {
          kind: "session",
          owner_id: binding.tugSessionId,
          display_name: binding.tugSessionId.slice(0, 8),
          live: true,
          files: [],
        },
      });
    }
    items.push(...dashes);
    if (project.unattributed.length > 0) {
      items.push({
        kind: "unattributed",
        id: `unattributed:${project.project_dir}`,
        project,
        files: project.unattributed,
      });
    }
  }
  return items;
}

/** The open dev cards' bindings, read straight from the store ([L02]). */
function useOpenBindings(): ReadonlyMap<string, CardSessionBinding> {
  return useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    cardSessionBindingStore.getSnapshot,
  );
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** `project · branch ↑a ↓b`, or the non-repo phrase. */
function projectContext(project: ProjectChangeset): string {
  if (project.no_repo) return `${project.display_name} · not a git repository`;
  let context = `${project.display_name} · ${project.branch}`;
  if (project.ahead > 0) context += ` ↑${project.ahead}`;
  if (project.behind > 0) context += ` ↓${project.behind}`;
  return context;
}

/** Hover tooltip spelling out the ↑ahead / ↓behind glyphs; undefined when
 *  the branch is in sync (or there is no repo). */
function aheadBehindTitle(project: ProjectChangeset): string | undefined {
  if (project.no_repo) return undefined;
  const parts: string[] = [];
  if (project.ahead > 0) {
    parts.push(`${project.ahead} commit${project.ahead === 1 ? "" : "s"} ahead of upstream`);
  }
  if (project.behind > 0) {
    parts.push(`${project.behind} commit${project.behind === 1 ? "" : "s"} behind upstream`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function itemTitle(item: SectionItem): string {
  return item.kind === "unattributed" ? "Unattributed" : item.entry.display_name;
}

function itemSubtitle(item: SectionItem): string {
  switch (item.kind) {
    case "session":
      return `${projectContext(item.project)} · id ${item.entry.owner_id.slice(0, 8)}`;
    case "dash": {
      const { entry } = item;
      const rounds = `${entry.rounds} round${entry.rounds === 1 ? "" : "s"}`;
      const dirty = entry.worktree_dirty ? " · dirty worktree" : "";
      return `${item.project.display_name} · ${entry.base} · ${rounds}${dirty}`;
    }
    case "unattributed":
      return projectContext(item.project);
  }
}

function itemFileCount(item: SectionItem): number {
  return item.kind === "unattributed" ? item.files.length : item.entry.files.length;
}

/** The trailing status hint for an entry's TOC row. */
function itemStatusHint(item: SectionItem): { text: string; caution: boolean } {
  if (item.kind === "session" && item.project.no_repo) {
    return { text: "not a git repo", caution: false };
  }
  const count = itemFileCount(item);
  if (count > 0) {
    return { text: `${count} file${count === 1 ? "" : "s"}`, caution: true };
  }
  return { text: "clean", caution: false };
}

/** The entry's leading glyph: session live-dot, dash mark, or dashed circle. */
function ItemGlyph({ item }: { item: SectionItem }) {
  switch (item.kind) {
    case "session":
      return (
        <span
          className={`sessions-live-dot ${item.entry.live ? "sessions-live-dot-on" : ""}`}
          aria-hidden="true"
        />
      );
    case "dash":
      return (
        <span className="sessions-dash-mark" aria-hidden="true">
          ⌁
        </span>
      );
    case "unattributed":
      return (
        <CircleDashed size={12} className="sessions-unattributed-mark" aria-hidden="true" />
      );
  }
}

// ---------------------------------------------------------------------------
// File rows
// ---------------------------------------------------------------------------

/** Tone class for a git-status glyph (first significant letter wins). */
function statusToneClass(gitStatus: string): string {
  if (gitStatus.startsWith("??")) return "sessions-status-untracked";
  const letter = gitStatus.replace(/[.\s]/g, "").charAt(0);
  switch (letter) {
    case "A":
      return "sessions-status-added";
    case "D":
      return "sessions-status-deleted";
    case "R":
      return "sessions-status-renamed";
    default:
      return "sessions-status-modified";
  }
}

/** Render the porcelain XY pair with dots shown as spaces (v1 style). */
function statusGlyph(gitStatus: string): string {
  return gitStatus.replace(/\./g, " ");
}

/**
 * Whether a file still exists on disk to open. A deleted file (op
 * `deleted`, or a `D` in either porcelain status axis) has no target, so
 * its path renders as plain text rather than a link.
 */
function isDeleted(op: string, gitStatus: string): boolean {
  return op === "deleted" || /D/.test(gitStatus);
}

/**
 * A repo-relative file path, rendered as an `open-file` link when the file
 * still exists. Absolute path = the project's `project_dir` (the checkout
 * root) joined with the repo-relative path. Reuses the same dispatch + focus
 * discipline as `ToolFileRef`: a primary click opens the file in a Text card
 * without stealing first-responder from this read-only card; a right-click
 * offers Open in Editor / Show in Finder. Deleted files (and the case where
 * no project root is known) render inert.
 */
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
    // Suppress WebKit's mousedown focus default for the primary open
    // gesture so opening a file never pulls focus onto this read-only card
    // (the target Text card claims focus via its own activation path).
    if (event.button !== 0 || event.metaKey || event.shiftKey) return;
    event.preventDefault();
  }, []);

  if (isDeleted(op, gitStatus) || !projectRoot) {
    return (
      <span className="sessions-file-path" title={path}>
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
        className="sessions-file-path sessions-file-path--link"
        data-slot="sessions-file-ref"
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

/**
 * Whether a file has a `git diff HEAD` to show. Untracked files (`??`)
 * have no HEAD-side content, so a scoped diff would come back empty — the
 * path link (which opens the file itself) is the whole story for them.
 */
function hasHeadDiff(gitStatus: string): boolean {
  return !gitStatus.startsWith("??");
}

/** Pop a diff descriptor out into its own Diff card ([P20]). */
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
      data-testid="sessions-diff-popout"
      onClick={() =>
        dispatchAction({ action: TUG_ACTIONS.OPEN_DIFF, descriptor })
      }
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

/**
 * The diff descriptor for a whole entry: `git diff HEAD` scoped to the
 * entry's diffable paths for sessions/unattributed (head flavor), or the
 * dash range (rounds + worktree dirt) for dashes. `null` when there is
 * nothing to diff (a non-repo project, or no file has a HEAD side).
 */
function entryDiffDescriptor(item: SectionItem): DiffDescriptor | null {
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

/**
 * The pop-out descriptor for one file. Head entries pop out just that path;
 * a dash file has no HEAD side, so it pops out the whole dash range (the
 * server can't scope a range diff to one path).
 */
function fileDiffDescriptor(item: SectionItem, file: GitDiffFileRef): DiffDescriptor | null {
  if (item.kind === "dash") return entryDiffDescriptor(item);
  if (item.project.no_repo || !hasHeadDiff(file.git_status)) return null;
  return { kind: "head", root: item.project.project_dir, paths: [file.path] };
}

/** The minimal file shape both `ChangesetFile` and `UnattributedFile` satisfy. */
interface GitDiffFileRef {
  path: string;
  git_status: string;
}

/**
 * The entry's inline diff store + snapshot. One `GitDiffStore` per entry over
 * the shared unfiltered GIT_DIFF feed; `ensureRequested` fires the entry's
 * descriptor once per distinct scope (a superseding scope re-requests).
 */
function useEntryDiff(item: SectionItem): {
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

/**
 * One file's diff as the BODY of its file block: the embedded `DiffBlock`
 * (`embedded={true}` — the under-a-chrome mode that portals the view-toggle /
 * fold affordances into the chrome's actions slot and drops its own identity
 * header), or a loading / error / binary / missing note. Returns `null` when
 * the entry has no HEAD side to diff (an untracked, non-dash file) — the
 * chrome then auto-disables its disclosure chevron ([P29]).
 */
function fileBlockBody(
  snapshot: GitDiffSnapshot,
  path: string,
  canDiff: boolean,
): React.ReactNode {
  if (!canDiff) return null;
  if (snapshot.phase === "error") {
    return (
      <p className="sessions-file-block-notice" role="alert">
        {snapshot.error ?? "Couldn't load the diff."}
      </p>
    );
  }
  if (snapshot.phase === "loading" || snapshot.payload === null) {
    return (
      <p className="sessions-file-block-notice" role="status">
        Loading diff…
      </p>
    );
  }
  const file = snapshot.payload.files.find((f) => f.path === path);
  if (file === undefined) {
    return (
      <p className="sessions-file-block-notice" role="status">
        No diff for this file.
      </p>
    );
  }
  if (file.binary) {
    return (
      <p className="sessions-file-block-notice" role="note">
        Binary file — no textual diff.
      </p>
    );
  }
  // `embedded` (NOT `suppressHeader`): the under-a-chrome contract that portals
  // the view-toggle / fold affordances into the file block's header actions
  // slot AND drops DiffBlock's own identity header. `suppressHeader` alone would
  // render the diff with no portaled affordances.
  return (
    <DiffBlock
      data={{ source: "unified", text: file.unified, filePath: file.path }}
      embedded
    />
  );
}

/**
 * The row's commit-selection checkbox ([P15]): a chain control whose
 * `toggle` lands in the entry's responder form ([L11]).
 */
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
      data-testid="sessions-file-select"
      data-path={path}
    />
  );
}

/** Per-row selection wiring handed down from the entry's commit state. */
interface RowSelection {
  senderId: string;
  selected: boolean;
  disabled: boolean;
}

/**
 * The normalized shape a file block renders — the common denominator of
 * `ChangesetFile` (session / dash: op + origin + ambiguous/shared) and
 * `UnattributedFile` (path + status only). One component renders all three.
 */
interface FileBlockData {
  path: string;
  git_status: string;
  /** `""` for unattributed files (no provenance). */
  op: string;
  /** `""` for unattributed files (no provenance shown). */
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

/**
 * The file block's identity (the header `target`): status glyph, the
 * `FilePathLink`, and the provenance + ambiguous/shared metadata as trailing
 * pipe-delimited sections. `FilePathLink` keeps its `OPEN_FILE` dispatch,
 * context menu, and `data-tug-focus="refuse"` + mousedown-preventDefault focus
 * discipline unchanged (the card must not steal first responder).
 */
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
    <span className="sessions-file-identity">
      <span className={`sessions-file-status ${statusToneClass(file.git_status)}`}>
        {statusGlyph(file.git_status)}
      </span>
      <FilePathLink
        path={file.path}
        op={file.op}
        gitStatus={file.git_status}
        projectRoot={projectRoot}
      />
      {file.ambiguous ? (
        <span className="sessions-badge sessions-badge-ambiguous">ambiguous</span>
      ) : null}
      {file.shared ? (
        <span className="sessions-badge sessions-badge-shared">shared</span>
      ) : null}
      {provenance !== null ? (
        <span className="sessions-file-provenance">{provenance}</span>
      ) : null}
    </span>
  );
}

/**
 * One changeset file rendered as a verb-less `BlockChrome` ([P25], [P29]):
 * the commit checkbox in the header `leading` slot (session/unattributed; a
 * dash row omits it, so the lifecycle dot shows a neutral `idle`), the status
 * glyph + `FilePathLink` as identity, the monochrome `+N −M` in the header
 * summary slot (sourced from the entry's per-entry diff snapshot; omitted until
 * the snapshot carries this file), a pop-out as a header action, and the file's
 * `DiffBlock` `embedded` as the collapse-by-unmount body.
 *
 * The disclosure chevron + collapse come from a card-local
 * `ToolBlockCollapseContext.Provider` (a standalone `BlockChrome` renders no
 * chevron and always mounts its body). An untracked, non-dash file has no HEAD
 * side (`canDiff` false → `children={null}`), so the chrome auto-disables the
 * chevron.
 */
function SessionsFileBlock({
  item,
  file,
  projectRoot,
  selection,
  diffSnapshot,
  collapsed,
  onToggle,
}: {
  item: SectionItem;
  file: FileBlockData;
  projectRoot: string;
  selection?: RowSelection;
  diffSnapshot: GitDiffSnapshot;
  collapsed: boolean;
  onToggle: (next: boolean) => void;
}) {
  const canDiff = item.kind === "dash" || hasHeadDiff(file.git_status);
  const diffFile = diffSnapshot.payload?.files.find((f) => f.path === file.path);
  // The monochrome `+N −M` badge, once the entry snapshot carries this file.
  const resultSummary: ToolResultSummary | undefined =
    diffFile !== undefined && !diffFile.binary
      ? { kind: "diff", added: diffFile.added, removed: diffFile.removed }
      : undefined;
  const popOut = fileDiffDescriptor(item, {
    path: file.path,
    git_status: file.git_status,
  });
  // Card-local collapse handle: the chevron + collapse-by-unmount fall out of a
  // provider whose `{collapsed, toggle}` is driven by the entry's `expandedFiles`
  // state ([L24] local-data; [L26] the provider keeps stable mount identity, so
  // the body subtree appears/disappears without tearing the block down). The
  // synthetic `toolUseId` is not a real tool call — it just gives the block a
  // stable id + `data-tool-use-id`.
  const handle = useMemo<ToolBlockCollapseHandle>(
    () => ({ collapsed, toggle: onToggle, toolUseId: `${item.id}|${file.path}` }),
    [collapsed, onToggle, item.id, file.path],
  );
  return (
    <ToolBlockCollapseContext.Provider value={handle}>
      <div
        className="sessions-file-block"
        data-testid="sessions-file-block"
        data-path={file.path}
      >
        <BlockChrome
          variant="tool"
          // Verb-less (no `toolName`); a neutral `idle` dot for a dash row that
          // has no leading checkbox.
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
// Entry block + body
// ---------------------------------------------------------------------------

/**
 * The entry's header identity (the `target` slot): title over the
 * project · branch · id context, with the spelled-out ahead/behind tooltip.
 */
function EntryIdentity({ item }: { item: SectionItem }) {
  return (
    <span className="sessions-entry-identity">
      <span
        className={`sessions-entry-title${
          item.kind === "unattributed" ? " sessions-entry-title-muted" : ""
        }`}
      >
        {itemTitle(item)}
      </span>
      <span
        className="sessions-entry-context"
        title={item.kind === "dash" ? undefined : aheadBehindTitle(item.project)}
      >
        {itemSubtitle(item)}
      </span>
    </span>
  );
}

/**
 * One changeset entry rendered as a top-level verb-less `BlockChrome`
 * section: the entry glyph in the header `leading` slot, title + context as
 * identity, the status hint ("N files" / "clean" / "not a git repo") as the
 * trailing summary, and the whole `EntryBody` as the collapse-by-unmount
 * body. No `headerActions` — the disclosure chevron is the only trailing
 * affordance; every entry affordance (diff cluster, dash actions, composer)
 * lives in the body.
 *
 * The chevron + collapse come from a card-local
 * `ToolBlockCollapseContext.Provider` driven by the card's collapsed-ids
 * set ([L24] local data; [L26] the provider keeps stable mount identity —
 * only the body subtree unmounts across the toggle). Collapse-by-unmount is
 * load-bearing: `EntryBody` fires its diff fetch on mount, so a collapsed
 * entry costs nothing. The wrapper carries the entry's test identity
 * (`data-entry-id` / `data-project-dir` / `data-session-id`).
 */
function SessionsEntryBlock({
  item,
  collapsed,
  onToggle,
  children,
}: {
  item: SectionItem;
  collapsed: boolean;
  onToggle: (next: boolean) => void;
  children: React.ReactNode;
}) {
  const hint = itemStatusHint(item);
  const handle = useMemo<ToolBlockCollapseHandle>(
    () => ({ collapsed, toggle: onToggle, toolUseId: item.id }),
    [collapsed, onToggle, item.id],
  );
  return (
    <ToolBlockCollapseContext.Provider value={handle}>
      <div
        className="sessions-entry"
        data-testid="sessions-entry"
        data-entry-id={item.id}
        data-project-dir={item.project.project_dir}
        data-session-id={item.kind === "session" ? item.entry.owner_id : undefined}
      >
        <BlockChrome
          variant="tool"
          phase="idle"
          leading={<ItemGlyph item={item} />}
          identity={<EntryIdentity item={item} />}
          resultSummary={{ kind: "text", text: hint.text }}
          className="sessions-entry-block"
        >
          {children}
        </BlockChrome>
      </div>
    </ToolBlockCollapseContext.Provider>
  );
}

/** A session entry in a non-git directory: the "Initialize git" affordance. */
function NonRepoBody({ projectDir }: { projectDir: string }) {
  const { phase, error, init } = useChangesetGitInit(projectDir);
  return (
    <div className="sessions-non-repo" role="group" data-testid="sessions-non-repo">
      <div className="sessions-non-repo-message">
        This directory is not a git repository.
      </div>
      <TugPushButton
        emphasis="outlined"
        role="accent"
        onClick={init}
        disabled={phase === "pending"}
        data-testid="sessions-git-init"
      >
        Initialize git
      </TugPushButton>
      {error !== null && (
        <div className="sessions-non-repo-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** The maintained draft for an entry (Spec S10): session/dash on the entry,
 *  unattributed on the project. */
function entryDraft(item: SectionItem): ChangesetDraft | undefined {
  return item.kind === "unattributed"
    ? item.project.unattributed_draft
    : item.entry.draft;
}

/** A file the entry can commit: its path plus its default selection. */
interface SelectableFile {
  path: string;
  /** Ambiguous and shared rows start deselected — explicit opt-in ([P15]). */
  defaultSelected: boolean;
}

/**
 * The expanded body of one entry — its file list (or clean/init state), the
 * inline diff affordances ([P20]), and the commit flow ([P15]).
 *
 * Diffs render inline: a file's diff button toggles its `DiffBlock` under the
 * row; the entry-level action toggles the whole `TugDiffDocument` in the body.
 * Both source from one per-entry `GitDiffStore` — head flavor (`git diff HEAD`
 * scoped to the entry's diffable paths) for sessions/unattributed, the dash
 * range (rounds + worktree dirt) for dashes, which now get real diffs too.
 * Each diff carries an "open as card" pop-out (`OPEN_DIFF`). Untracked files
 * (no HEAD side) get no per-file diff.
 *
 * The same entries get the commit flow: per-file checkboxes (ambiguous /
 * shared rows deselected by default — explicit opt-in), a message field
 * (TugInput carries the substrate responders), and a width-stabilized
 * commit button. Selection is kept as per-path *overrides* over the
 * defaults, so a snapshot that removes files (committed elsewhere)
 * reconciles by construction — vanished paths simply stop contributing.
 * Errors surface through `onError` (the card's TugAlert sheet).
 */
/**
 * Dash entry actions ([P14]/[P31]/[P32]): Join (preview → confirm, or conflict
 * list → Resolve conflicts) and Release (with a discard confirm). The resolve
 * flow runs the ladder and streams a `/btw`-style progress overlay
 * (`useChangesetJoinResolve`); on full resolution it shows the resolved files
 * badged by rung and a Join that lands the pre-built candidate; partial
 * resolutions keep the honest conflict list. Join preview/execute are
 * near-instant (only the AI rung is slow), so a `pending` shows a compact
 * working line rather than swapping panes. Confirm-before-join is the preview
 * gate; Release confirms inline. [L02] all state via the verb/join stores'
 * `useSyncExternalStore` hooks; [L06] no appearance state in React.
 */
function DashActions({ item }: { item: DashItem }) {
  const entryKey = item.id;
  const projectRoot = item.project.project_dir;
  const dashName = item.entry.display_name;
  const base = item.entry.base;

  const join = useChangesetJoin(entryKey);
  const resolve = useChangesetJoinResolve(projectRoot, dashName);
  const release = useChangesetRelease(entryKey);
  const [confirmingRelease, setConfirmingRelease] = useState(false);

  // A landed join drops the entry on the next aggregate bump; clear the overlay
  // so a stale resolve pane never lingers if the drop lags.
  useEffect(() => {
    if (join.phase === "done") resolve.clear();
  }, [join.phase, resolve]);

  // ---- Resolve overlay (takes precedence while a resolve is in flight) ----
  if (resolve.phase === "resolving") {
    return (
      <div className="sessions-dash-resolve" data-testid="sessions-dash-resolving">
        <div className="sessions-dash-resolve-head">Resolving conflicts…</div>
        {resolve.progress.map((p) => (
          <div key={p.path} className="sessions-dash-resolve-file">
            <span className="sessions-dash-resolve-path">{p.path}</span>
            <span className="sessions-dash-resolve-rung">
              {p.rung} · {p.status}
            </span>
            {p.text.length > 0 ? (
              <pre className="sessions-dash-resolve-stream">{p.text}</pre>
            ) : null}
          </div>
        ))}
      </div>
    );
  }
  if (resolve.phase === "resolved") {
    return (
      <div className="sessions-dash-actions" data-testid="sessions-dash-resolved">
        <div className="sessions-dash-resolve-summary">
          Resolved {resolve.resolved.length} file
          {resolve.resolved.length === 1 ? "" : "s"}
          {resolve.shape === "replay" ? " (replayed rounds)" : ""}:
        </div>
        <ul className="sessions-dash-resolved-list">
          {resolve.resolved.map((r) => (
            <li key={r.path}>
              <span className="sessions-dash-resolve-path">{r.path}</span>
              <span className="sessions-dash-rung-badge">{r.resolvedBy}</span>
            </li>
          ))}
        </ul>
        {join.phase === "pending" ? (
          <div className="sessions-dash-working">Joining…</div>
        ) : (
          <div className="sessions-dash-action-row">
            <TugPushButton
              size="sm"
              emphasis="outlined"
              role="accent"
              disabled={resolve.candidateCommit === null}
              widthStabilize={{ alternateLabel: "Joining…" }}
              onClick={() =>
                resolve.candidateCommit !== null &&
                join.join(projectRoot, dashName, {
                  preview: false,
                  candidate: resolve.candidateCommit,
                })
              }
              data-testid="sessions-dash-join-candidate"
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
      <div className="sessions-dash-actions" data-testid="sessions-dash-partial">
        <div className="sessions-dash-resolve-summary">
          Resolved {resolve.resolved.length}; {resolve.unresolved.length} still
          conflicting:
        </div>
        <ul className="sessions-dash-conflict-list">
          {resolve.unresolved.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="sessions-dash-hint">
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
      <div className="sessions-dash-actions">
        <div className="sessions-dash-error">Resolve failed: {resolve.error}</div>
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

  // ---- Join preview / execute ----
  if (join.phase === "pending") {
    return <div className="sessions-dash-working">Working…</div>;
  }
  if (join.phase === "preview" && join.conflicts.length === 0) {
    return (
      <div
        className="sessions-dash-actions"
        data-testid="sessions-dash-preview-clean"
      >
        <div className="sessions-dash-preview-msg">
          Joins cleanly into {base}.
        </div>
        <div className="sessions-dash-action-row">
          <TugPushButton
            size="sm"
            emphasis="outlined"
            role="accent"
            widthStabilize={{ alternateLabel: "Joining…" }}
            onClick={() => join.join(projectRoot, dashName, { preview: false })}
            data-testid="sessions-dash-confirm-join"
          >
            Confirm join
          </TugPushButton>
          <TugPushButton
            size="sm"
            emphasis="ghost"
            role="action"
            onClick={() => join.clear()}
          >
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
      <div
        className="sessions-dash-actions"
        data-testid="sessions-dash-preview-conflicts"
      >
        <div className="sessions-dash-preview-msg">
          Conflicts in {join.conflicts.length} file
          {join.conflicts.length === 1 ? "" : "s"}:
        </div>
        <ul className="sessions-dash-conflict-list">
          {join.conflicts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="sessions-dash-action-row">
          <TugPushButton
            size="sm"
            emphasis="outlined"
            role="accent"
            onClick={() => resolve.resolve()}
            data-testid="sessions-dash-resolve"
          >
            Resolve conflicts
          </TugPushButton>
          <TugPushButton
            size="sm"
            emphasis="ghost"
            role="action"
            onClick={() => join.clear()}
          >
            Cancel
          </TugPushButton>
        </div>
      </div>
    );
  }
  if (join.phase === "error") {
    return (
      <div className="sessions-dash-actions">
        <div className="sessions-dash-error">Join failed: {join.error}</div>
        <TugPushButton
          size="sm"
          emphasis="ghost"
          role="action"
          onClick={() => join.clear()}
        >
          Dismiss
        </TugPushButton>
      </div>
    );
  }
  if (join.phase === "done") {
    // The entry drops on the next aggregate bump.
    return null;
  }

  // ---- Idle: Join / Release ----
  return (
    <div className="sessions-dash-actions" data-testid="sessions-dash-idle">
      <div className="sessions-dash-action-row">
        <TugPushButton
          size="sm"
          emphasis="outlined"
          role="accent"
          onClick={() => join.join(projectRoot, dashName, { preview: true })}
          data-testid="sessions-dash-join"
        >
          Join
        </TugPushButton>
        {confirmingRelease ? (
          <>
            <TugPushButton
              size="sm"
              emphasis="outlined"
              role="danger"
              disabled={release.phase === "pending"}
              widthStabilize={{ alternateLabel: "Discarding…" }}
              onClick={() => {
                release.release(projectRoot, dashName);
                setConfirmingRelease(false);
              }}
              data-testid="sessions-dash-release-confirm"
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
            data-testid="sessions-dash-release"
          >
            Release
          </TugPushButton>
        )}
      </div>
      {release.phase === "error" ? (
        <div className="sessions-dash-error">Release failed: {release.error}</div>
      ) : null}
    </div>
  );
}

function EntryBody({
  item,
  onError,
}: {
  item: SectionItem;
  onError?: (title: string, message: string) => void;
}) {
  const projectRoot = item.project.project_dir;

  // Per-file collapse state ([P29]): the set of expanded file paths, surfaced
  // to each file block through a card-local `ToolBlockCollapseContext.Provider`
  // (NOT the transcript's persisted `ToolBlockExpansionContext`; plain local
  // data). `collapsed = !expandedFiles.has(path)`. All file bodies read one
  // per-entry `GitDiffStore` snapshot.
  const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(new Set());
  const { snapshot: diffSnapshot, ensureRequested } = useEntryDiff(item);
  const entryDescriptor = useMemo(() => entryDiffDescriptor(item), [item]);
  // Eager fetch: this body is mounted only while its entry block is expanded
  // (the chrome's collapse-by-unmount withholds a collapsed body), so
  // requesting on mount shows the per-file `+N −M` badges at rest — before
  // any file is expanded — at a cost of one `git diff` per OPEN entry
  // ([P29] fetch timing).
  useEffect(() => {
    ensureRequested();
  }, [ensureRequested]);
  // The collapse handle's `toggle(next)` carries the NEXT collapsed value:
  // collapse ⇒ drop the path from the expanded set; expand ⇒ add it.
  const toggleFile = useCallback((path: string, nextCollapsed: boolean) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (nextCollapsed) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Commit-flow state. Hooks run for every entry kind (dash bodies just
  // never render the controls).
  const selectable: SelectableFile[] = useMemo(() => {
    if (item.kind === "session" && !item.project.no_repo) {
      return item.entry.files.map((file) => ({
        path: file.path,
        defaultSelected: !file.ambiguous && !file.shared,
      }));
    }
    if (item.kind === "unattributed") {
      return item.files.map((file) => ({ path: file.path, defaultSelected: true }));
    }
    return [];
  }, [item]);

  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [message, setMessage] = useState("");
  // The commit-message field is pinned once the user edits it, so a newer
  // draft never clobbers their text ([P24]); a landed commit unpins it.
  const [pinned, setPinned] = useState(false);
  const { phase, error, sha, receipt, commit, clear } = useChangesetCommit(item.id);

  const ownerKind = item.kind;
  const ownerId = item.kind === "unattributed" ? "" : item.entry.owner_id;

  // The maintained draft ([P21]): the live streamed text while regenerating,
  // else the persisted snapshot draft. `null` when there is none yet.
  const draftOverlay = useChangesetDraft(projectRoot, ownerKind, ownerId);
  const snapshotDraft = entryDraft(item);
  const draftText =
    draftOverlay.text.length > 0
      ? draftOverlay.text
      : (snapshotDraft?.message ?? null);
  const drafting = draftOverlay.phase === "drafting";
  const draftError = draftOverlay.phase === "error" ? draftOverlay.detail : null;

  // Whether this entry can back an on-demand draft ([P04]): a session or
  // unattributed entry with ≥1 file, or a dash with rounds / a dirty worktree.
  // The composer renders for a draftable entry even before a draft exists, so
  // the Generate affordance is reachable on a fresh entry.
  const isDraftable =
    item.kind === "dash"
      ? item.entry.rounds > 0 || item.entry.worktree_dirty
      : item.kind === "session"
        ? !item.project.no_repo && item.entry.files.length > 0
        : item.files.length > 0;

  const selectSender = (path: string): string => `${item.id}|${path}`;
  const { ResponderScope: CommitScope, responderRef: commitRef } = useResponderForm({
    toggle: Object.fromEntries(
      selectable.map((file) => [
        selectSender(file.path),
        (checked: boolean) =>
          setOverrides((prev) => new Map(prev).set(file.path, checked)),
      ]),
    ),
  });

  const isSelected = (file: SelectableFile): boolean =>
    overrides.get(file.path) ?? file.defaultSelected;
  const selectedPaths = selectable.filter(isSelected).map((file) => file.path);

  // A failed commit surfaces once through the card's alert sheet, then the
  // verb state returns to idle so the controls are usable again.
  useEffect(() => {
    if (phase !== "error" || error === null) return;
    onError?.("Couldn't Commit", error);
    clear();
  }, [phase, error, onError, clear]);

  // The CM6 commit field ([P26]/[P28]). New drafts stream in via `restoreState`
  // (programmatic — does not read as a user edit, so a pristine field follows
  // the draft without pinning); a user edit pins it; a landed commit clears +
  // unpins it.
  const editorRef = useRef<TugMessageEditorHandle | null>(null);

  // A landed commit clears the field and unpins it so the next draft flows in;
  // the receipt panel stays up until dismissed (or the next commit round).
  useEffect(() => {
    if (phase === "done") {
      editorRef.current?.clear();
      setMessage("");
      setPinned(false);
    }
  }, [phase]);

  // While the field is pristine, it follows the maintained draft — re-seeded
  // through the CM6 field's programmatic `restoreState` (which does not fire
  // `onChange`, so this seed never reads as a user edit, [P24]/[P28]).
  useEffect(() => {
    if (!pinned) {
      editorRef.current?.restoreState(draftText ?? "");
      setMessage(draftText ?? "");
    }
  }, [pinned, draftText]);

  const useLatestDraft = useCallback(() => {
    editorRef.current?.restoreState(draftText ?? "");
    setMessage(draftText ?? "");
    setPinned(false);
  }, [draftText]);

  if (item.kind === "session" && item.project.no_repo) {
    return <NonRepoBody projectDir={item.project.project_dir} />;
  }

  const files = item.kind === "unattributed" ? null : item.entry.files;

  // The entry's diffable file paths — the set Expand All / Collapse All drive.
  // Dash: every row (they share the range diff); head: the files with a HEAD
  // side (untracked files have no diff).
  const allFiles: readonly GitDiffFileRef[] =
    item.kind === "unattributed" ? item.files : (files ?? []);
  const diffablePaths = allFiles
    .filter((f) => item.kind === "dash" || hasHeadDiff(f.git_status))
    .map((f) => f.path);

  // The entry-level diff affordance ([P29]): Expand All / Collapse All across
  // the entry's file blocks plus ONE whole-entry pop-out (`OPEN_DIFF` with the
  // entry descriptor). The draft is generated on demand from the composer's
  // Generate button ([P04]); the in-card `TugDiffDocument` expansion is removed.
  const entryDiffActionsRow = () => {
    if (entryDescriptor === null || diffablePaths.length === 0) return null;
    return (
      <div className="sessions-entry-actions">
        {diffablePaths.length > 1 ? (
          <>
            <TugPushButton
              emphasis="ghost"
              role="action"
              size="2xs"
              onClick={() => setExpandedFiles(new Set(diffablePaths))}
              data-testid="sessions-entry-expand-all"
            >
              Expand All
            </TugPushButton>
            <TugPushButton
              emphasis="ghost"
              role="action"
              size="2xs"
              onClick={() => setExpandedFiles(new Set())}
              data-testid="sessions-entry-collapse-all"
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
    );
  };

  const rowSelection = (path: string): RowSelection => ({
    senderId: selectSender(path),
    selected: overrides.get(path) ?? selectable.find((f) => f.path === path)?.defaultSelected ?? true,
    disabled: phase === "pending",
  });

  // The commit composer is ONE BlockChrome ([P28]): the lifecycle dot IS the
  // drafting indicator (in_flight while the scribe streams, success when the
  // draft lands, error on scribe failure — the error hint rides the chrome's
  // notice band so it stays visible WITHOUT blanking the draft). Header actions:
  // copy-draft + "Use latest draft". Body: the CM6 `TugMessageEditor` ([P26])
  // pre-filled from the maintained draft while pristine, or the numstat receipt
  // once a commit lands. Footer: the width-stabilized Commit button. Dash entries
  // render it read-only — the maintained join-message draft with no commit
  // controls (committing a dash is M04's join). The block is NOT wrapped in a
  // `ToolBlockCollapseContext.Provider` — it wants the always-expanded standalone
  // default. [L02] read-only derivation from the draft overlay + commit phase;
  // [L06] the dot paints via CSS/DOM inside the indicator.
  const hasCommit = selectable.length > 0;
  const showReceipt = phase === "done" && receipt !== null;
  const commitComposer =
    !(hasCommit || draftText !== null || drafting || isDraftable) ? null : (
      <div className="sessions-commit" data-testid="sessions-commit-controls">
        <BlockChrome
          variant="tool"
          toolName={item.kind === "dash" ? "Join message" : "Commit message"}
          phase={
            draftError !== null
              ? "error"
              : drafting
                ? "in_flight"
                : draftText !== null
                  ? "success"
                  : "idle"
          }
          notice={
            draftError !== null ? { tone: "error", text: draftError } : undefined
          }
          headerActions={
            <>
              {isDraftable ? (
                <TugPushButton
                  size="sm"
                  emphasis="ghost"
                  role="action"
                  disabled={drafting}
                  onClick={() => {
                    // Generate is an explicit "replace with a fresh draft" act:
                    // unpin first so the pristine-follow effect lets the streamed
                    // deltas flow into the field ([Q03]/[P04]).
                    setPinned(false);
                    draftOverlay.requestDraft();
                  }}
                  data-testid="sessions-generate-draft"
                >
                  Generate message
                </TugPushButton>
              ) : null}
              {draftText !== null ? (
                <BlockCopyButton
                  subtype="icon"
                  emphasis="ghost"
                  size="2xs"
                  aria-label="Copy the draft message"
                  getText={() => draftText}
                />
              ) : null}
              {pinned && draftText !== null && draftText !== message ? (
                <TugPushButton
                  size="sm"
                  emphasis="ghost"
                  role="action"
                  onClick={useLatestDraft}
                  data-testid="sessions-use-latest-draft"
                >
                  Use latest draft
                </TugPushButton>
              ) : null}
            </>
          }
          footerBadges={
            hasCommit && !showReceipt ? (
              <TugPushButton
                size="sm"
                emphasis="outlined"
                role="accent"
                disabled={
                  phase === "pending" ||
                  selectedPaths.length === 0 ||
                  message.trim().length === 0
                }
                widthStabilize={{ alternateLabel: "Committing…" }}
                onClick={() => commit(projectRoot, selectedPaths, message.trim())}
                data-testid="sessions-commit-button"
              >
                {phase === "pending" ? "Committing…" : "Commit"}
              </TugPushButton>
            ) : undefined
          }
          className="sessions-commit-composer"
        >
          {showReceipt ? (
            <div className="sessions-commit-receipt" data-testid="sessions-commit-receipt">
              <div className="sessions-commit-receipt-head">
                <span className="sessions-commit-receipt-sha">
                  Committed {sha === null ? "" : sha.slice(0, 10)}
                </span>
                <TugPushButton
                  size="2xs"
                  emphasis="ghost"
                  role="action"
                  onClick={clear}
                  data-testid="sessions-commit-receipt-dismiss"
                >
                  Dismiss
                </TugPushButton>
              </div>
              <pre className="sessions-commit-receipt-body">{receipt}</pre>
            </div>
          ) : (
            <TugMessageEditor
              ref={editorRef}
              placeholder="Commit message"
              lineWrap
              fontSize="var(--tug-font-size-sm)"
              disabled={!hasCommit || phase === "pending"}
              onChange={(text) => {
                setMessage(text);
                setPinned(true);
              }}
              onSubmit={
                hasCommit
                  ? () => {
                      if (
                        phase !== "pending" &&
                        selectedPaths.length > 0 &&
                        message.trim().length > 0
                      ) {
                        commit(projectRoot, selectedPaths, message.trim());
                      }
                    }
                  : undefined
              }
              aria-label="Commit message"
              data-testid="sessions-commit-message"
            />
          )}
        </BlockChrome>
      </div>
    );

  if (item.kind === "unattributed") {
    return (
      <CommitScope>
        <div
          ref={commitRef as (el: HTMLDivElement | null) => void}
          className="sessions-file-list"
          data-testid="sessions-unattributed"
        >
          {item.files.map((file) => (
            <SessionsFileBlock
              key={file.path}
              item={item}
              file={unattributedFileData(file)}
              projectRoot={projectRoot}
              selection={rowSelection(file.path)}
              diffSnapshot={diffSnapshot}
              collapsed={!expandedFiles.has(file.path)}
              onToggle={(next) => toggleFile(file.path, next)}
            />
          ))}
          {entryDiffActionsRow()}
          {commitComposer}
        </div>
      </CommitScope>
    );
  }

  if (files === null || files.length === 0) {
    return (
      <>
        <div className="sessions-clean" role="status">
          <CircleCheck size={14} />
          {item.kind === "dash" ? "No files past base" : "No changes from this session"}
        </div>
        {item.kind === "dash" ? <DashActions item={item} /> : null}
      </>
    );
  }

  return (
    <CommitScope>
      <div
        ref={commitRef as (el: HTMLDivElement | null) => void}
        className="sessions-file-list"
      >
        {files.map((file) => (
          <SessionsFileBlock
            key={file.path}
            item={item}
            file={changesetFileData(file)}
            projectRoot={projectRoot}
            selection={item.kind === "session" ? rowSelection(file.path) : undefined}
            diffSnapshot={diffSnapshot}
            collapsed={!expandedFiles.has(file.path)}
            onToggle={(next) => toggleFile(file.path, next)}
          />
        ))}
        {entryDiffActionsRow()}
        {commitComposer}
        {item.kind === "dash" ? <DashActions item={item} /> : null}
      </div>
    </CommitScope>
  );
}

// ---------------------------------------------------------------------------
// Sessions section — body + collapsed summary
// ---------------------------------------------------------------------------

/** The joined item list, from the same app-level singletons the section reads
 *  ([L02]). Shared by the body and the collapsed summary so they agree. */
function useSessionsItems(): SectionItem[] {
  const data = useChangesetAll();
  const bindings = useOpenBindings();
  return useMemo(() => buildItems(data, bindings), [data, bindings]);
}

/** Total dirty files across the shown entries: session/unattributed file
 *  lists, plus a dash's range files. */
function countDirtyFiles(items: readonly SectionItem[]): number {
  let n = 0;
  for (const item of items) {
    n += item.kind === "unattributed" ? item.files.length : item.entry.files.length;
  }
  return n;
}

/** The Lens band's live collapsed summary ([P07]): "N sessions · M dirty
 *  files" — the count that lets the collapsed section beat a dead title. */
function SessionsCollapsedSummary(): React.ReactElement {
  const items = useSessionsItems();
  const sessions = items.filter((item) => item.kind === "session").length;
  const dirty = countDirtyFiles(items);
  return (
    <>{`${sessions} session${sessions === 1 ? "" : "s"} · ${dirty} dirty file${
      dirty === 1 ? "" : "s"
    }`}</>
  );
}

function SessionsSectionBody(): React.ReactElement {
  const items = useSessionsItems();

  // Verb failures (commit, scribe) and scribe summaries surface as a
  // pane-modal TugAlert sheet. Diffs render inline in the entries ([P20]),
  // not through a sheet — the sheet host stays only for these alerts.
  const { showSheet, renderSheet } = useTugSheet();
  const presentNotice = useCallback(
    (title: string, message: string) => {
      void presentAlertSheet(showSheet, { title, message });
    },
    [showSheet],
  );

  // Drop per-entry inline-diff stores whose entries have left the snapshot.
  useEffect(() => {
    sweepEntryDiffStores(new Set(items.map((item) => item.id)));
  }, [items]);

  // Per-entry collapse ([L24]): the set of COLLAPSED entry ids, fed to each
  // entry block's collapse provider. Inverted from an open-list so open-once
  // is the default: an id a snapshot introduces is simply never in the set,
  // and a user's collapse persists across recomputes because the set is
  // keyed by (stable) entry id.
  const [collapsedEntries, setCollapsedEntries] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const entryIds = useMemo(() => items.map((item) => item.id), [items]);

  // Every id the card has seen. "Collapse all" covers the whole seen set —
  // not just the current snapshot — so an entry that is absent when the user
  // collapses everything comes back collapsed rather than popping open.
  const seenSectionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    entryIds.forEach((id) => seenSectionsRef.current.add(id));
  }, [entryIds]);

  // The collapse handle's `toggle(next)` carries the NEXT collapsed value.
  const toggleEntry = useCallback((id: string, nextCollapsed: boolean) => {
    setCollapsedEntries((prev) => {
      const next = new Set(prev);
      if (nextCollapsed) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    entryIds.forEach((id) => seenSectionsRef.current.add(id));
    setCollapsedEntries(new Set());
  }, [entryIds]);
  const collapseAll = useCallback(() => {
    entryIds.forEach((id) => seenSectionsRef.current.add(id));
    setCollapsedEntries(new Set(seenSectionsRef.current));
  }, [entryIds]);

  if (items.length === 0) {
    return (
      <div data-slot="sessions-card" className="sessions-card sessions-card-empty">
        No open sessions
      </div>
    );
  }

  // The band supplies the title + the live "N sessions · M dirty files"
  // summary ([Q04]); the body opens with the bulk-collapse buttons only.
  return (
    <div data-slot="sessions-card" className="sessions-card">
      <div className="sessions-head">
        <div className="sessions-toolbar">
          <span className="sessions-toolbar-spacer" />
          <TugPushButton
            emphasis="ghost"
            role="action"
            size="2xs"
            onClick={expandAll}
            data-testid="sessions-expand-all"
          >
            Expand all
          </TugPushButton>
          <TugPushButton
            emphasis="ghost"
            role="action"
            size="2xs"
            onClick={collapseAll}
            data-testid="sessions-collapse-all"
          >
            Collapse all
          </TugPushButton>
        </div>
      </div>
      <div className="sessions-scroll">
        <div className="sessions-sections">
          {items.map((item) => (
            <SessionsEntryBlock
              key={item.id}
              item={item}
              collapsed={collapsedEntries.has(item.id)}
              onToggle={(next) => toggleEntry(item.id, next)}
            >
              <EntryBody item={item} onError={presentNotice} />
            </SessionsEntryBlock>
          ))}
        </div>
      </div>
      {renderSheet()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerSessionsSection
// ---------------------------------------------------------------------------

/**
 * Register the Sessions Lens section ([P07]). Called once at boot from
 * `main.tsx`, beside `registerLogSection` / `registerTelemetrySection`. The
 * body reads the app-level `useChangesetAll` singleton directly (no host feed
 * wiring), so it is host-agnostic — nothing imported from `lens/` beyond the
 * registry entry point.
 */
export function registerSessionsSection(): void {
  registerLensSection({
    kind: "sessions",
    title: "Sessions",
    glyph: <GitBranch size={14} />,
    collapsedSummary: () => <SessionsCollapsedSummary />,
    body: () => <SessionsSectionBody />,
  });
}
