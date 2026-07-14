/**
 * Changeset card — the account-global view of every open session's dirty
 * state: one entry per session, plus per-project dash and unattributed
 * pseudo-entries.
 *
 * Renders the aggregate CHANGESET_ALL feed (0x24) joined against the open
 * dev cards (the card-session binding store). Each entry is a session bound
 * to an open dev card — the feed emits a (possibly fileless) entry for every
 * live session, titled by the chooser's rule (name → prompt snippet → id
 * prefix) — or a session with attributed dirty files, plus one entry per
 * dash worktree and an "Unattributed" entry per project with unclaimed dirty
 * files. A fixed table of contents (a bordered `TugListView`, one row per
 * entry) sits over a scrollable accordion of the same entries; file rows
 * carry a commit-selection checkbox, a git-status glyph, op/origin
 * provenance, ambiguous/shared badges, and a scoped-diff affordance.
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
 * Entry sections are a controlled `TugAccordion type="multiple"`. Sections a
 * snapshot introduces open themselves once, so a user's collapse sticks
 * across recomputes. A TOC click expands the entry and scrolls it into view
 * only when its trigger is outside the scroller's viewport — an in-view
 * section never hops.
 *
 * Laws: [L02] external state via useSyncExternalStore, [L06] appearance via
 *       CSS, [L11] controls emit actions, [L20] composed children keep
 *       their own tokens.
 *
 * @module components/tugways/cards/changeset-card
 */

import "./changeset-card.css";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CircleCheck, CircleDashed, SquareArrowOutUpRight } from "lucide-react";

import { registerCard } from "@/card-registry";
import { dispatchAction } from "@/action-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugListRow } from "@/components/tugways/tug-list-row";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
  type TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
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
import { BlockChrome } from "@/components/tugways/cards/blocks/block-chrome";
import type { ToolResultSummary } from "@/components/tugways/cards/blocks/tool-result-summary";
import {
  ToolBlockCollapseContext,
  type ToolBlockCollapseHandle,
} from "@/components/tugways/cards/blocks/collapse-context";
import { useChangesetAll } from "@/lib/changeset-all-store";
import {
  useChangesetCommit,
  useChangesetGitInit,
} from "@/lib/changeset-verb-store";
import { useChangesetDraft } from "@/lib/changeset-draft-store";
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

type ChangesetItem = SessionItem | DashItem | UnattributedItem;

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
): ChangesetItem[] {
  const workspaceKeys = new Set<string>();
  const boundSessionIds = new Set<string>();
  for (const binding of bindings.values()) {
    workspaceKeys.add(binding.workspaceKey);
    boundSessionIds.add(binding.tugSessionId);
  }

  const items: ChangesetItem[] = [];
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

function itemTitle(item: ChangesetItem): string {
  return item.kind === "unattributed" ? "Unattributed" : item.entry.display_name;
}

function itemSubtitle(item: ChangesetItem): string {
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

function itemFileCount(item: ChangesetItem): number {
  return item.kind === "unattributed" ? item.files.length : item.entry.files.length;
}

/** The trailing status hint for an entry's TOC row. */
function itemStatusHint(item: ChangesetItem): { text: string; caution: boolean } {
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
function ItemGlyph({ item }: { item: ChangesetItem }) {
  switch (item.kind) {
    case "session":
      return (
        <span
          className={`changeset-live-dot ${item.entry.live ? "changeset-live-dot-on" : ""}`}
          aria-hidden="true"
        />
      );
    case "dash":
      return (
        <span className="changeset-dash-mark" aria-hidden="true">
          ⌁
        </span>
      );
    case "unattributed":
      return (
        <CircleDashed size={12} className="changeset-unattributed-mark" aria-hidden="true" />
      );
  }
}

// ---------------------------------------------------------------------------
// File rows
// ---------------------------------------------------------------------------

/** Tone class for a git-status glyph (first significant letter wins). */
function statusToneClass(gitStatus: string): string {
  if (gitStatus.startsWith("??")) return "changeset-status-untracked";
  const letter = gitStatus.replace(/[.\s]/g, "").charAt(0);
  switch (letter) {
    case "A":
      return "changeset-status-added";
    case "D":
      return "changeset-status-deleted";
    case "R":
      return "changeset-status-renamed";
    default:
      return "changeset-status-modified";
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
      <span className="changeset-file-path" title={path}>
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
        className="changeset-file-path changeset-file-path--link"
        data-slot="changeset-file-ref"
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
      data-testid="changeset-diff-popout"
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
function entryDiffDescriptor(item: ChangesetItem): DiffDescriptor | null {
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
function fileDiffDescriptor(item: ChangesetItem, file: GitDiffFileRef): DiffDescriptor | null {
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
function useEntryDiff(item: ChangesetItem): {
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
      <p className="changeset-file-block-notice" role="alert">
        {snapshot.error ?? "Couldn't load the diff."}
      </p>
    );
  }
  if (snapshot.phase === "loading" || snapshot.payload === null) {
    return (
      <p className="changeset-file-block-notice" role="status">
        Loading diff…
      </p>
    );
  }
  const file = snapshot.payload.files.find((f) => f.path === path);
  if (file === undefined) {
    return (
      <p className="changeset-file-block-notice" role="status">
        No diff for this file.
      </p>
    );
  }
  if (file.binary) {
    return (
      <p className="changeset-file-block-notice" role="note">
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
      data-testid="changeset-file-select"
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
    <span className="changeset-file-identity">
      <span className={`changeset-file-status ${statusToneClass(file.git_status)}`}>
        {statusGlyph(file.git_status)}
      </span>
      <FilePathLink
        path={file.path}
        op={file.op}
        gitStatus={file.git_status}
        projectRoot={projectRoot}
      />
      {file.ambiguous ? (
        <span className="changeset-badge changeset-badge-ambiguous">ambiguous</span>
      ) : null}
      {file.shared ? (
        <span className="changeset-badge changeset-badge-shared">shared</span>
      ) : null}
      {provenance !== null ? (
        <span className="changeset-file-provenance">{provenance}</span>
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
function ChangesetFileBlock({
  item,
  file,
  projectRoot,
  selection,
  diffSnapshot,
  collapsed,
  onToggle,
}: {
  item: ChangesetItem;
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
        className="changeset-file-block"
        data-testid="changeset-file-block"
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
// Entry trigger + body
// ---------------------------------------------------------------------------

/** The collapsed trigger for one entry. */
function EntryTrigger({ item }: { item: ChangesetItem }) {
  return (
    <span className="changeset-entry-trigger">
      <ItemGlyph item={item} />
      <span
        className={`changeset-entry-title${
          item.kind === "unattributed" ? " changeset-entry-title-muted" : ""
        }`}
      >
        {itemTitle(item)}
      </span>
      <span
        className="changeset-entry-context"
        title={item.kind === "dash" ? undefined : aheadBehindTitle(item.project)}
      >
        {itemSubtitle(item)}
      </span>
    </span>
  );
}

/** A session entry in a non-git directory: the "Initialize git" affordance. */
function NonRepoBody({ projectDir }: { projectDir: string }) {
  const { phase, error, init } = useChangesetGitInit(projectDir);
  return (
    <div className="changeset-non-repo" role="group" data-testid="changeset-non-repo">
      <div className="changeset-non-repo-message">
        This directory is not a git repository.
      </div>
      <TugPushButton
        emphasis="outlined"
        role="accent"
        onClick={init}
        disabled={phase === "pending"}
        data-testid="changeset-git-init"
      >
        Initialize git
      </TugPushButton>
      {error !== null && (
        <div className="changeset-non-repo-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** The maintained draft for an entry (Spec S10): session/dash on the entry,
 *  unattributed on the project. */
function entryDraft(item: ChangesetItem): ChangesetDraft | undefined {
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
function EntryBody({
  item,
  onError,
}: {
  item: ChangesetItem;
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
  // Eager fetch: this body is mounted only while its accordion section is open
  // (Radix unmounts a collapsed section's content), so requesting on mount
  // shows the per-file `+N −M` badges at rest — before any file is expanded —
  // at a cost of one `git diff` per OPEN entry ([P29] fetch timing).
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
  // entry descriptor). (Summarize/Draft retired — the draft is maintained
  // automatically, [P21]; the in-card `TugDiffDocument` expansion is removed.)
  const entryDiffActionsRow = () => {
    if (entryDescriptor === null || diffablePaths.length === 0) return null;
    return (
      <div className="changeset-entry-actions">
        {diffablePaths.length > 1 ? (
          <>
            <TugPushButton
              emphasis="ghost"
              role="action"
              size="2xs"
              onClick={() => setExpandedFiles(new Set(diffablePaths))}
              data-testid="changeset-entry-expand-all"
            >
              Expand All
            </TugPushButton>
            <TugPushButton
              emphasis="ghost"
              role="action"
              size="2xs"
              onClick={() => setExpandedFiles(new Set())}
              data-testid="changeset-entry-collapse-all"
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
    !(hasCommit || draftText !== null || drafting) ? null : (
      <div className="changeset-commit" data-testid="changeset-commit-controls">
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
                  data-testid="changeset-use-latest-draft"
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
                data-testid="changeset-commit-button"
              >
                {phase === "pending" ? "Committing…" : "Commit"}
              </TugPushButton>
            ) : undefined
          }
          className="changeset-commit-composer"
        >
          {showReceipt ? (
            <div className="changeset-commit-receipt" data-testid="changeset-commit-receipt">
              <div className="changeset-commit-receipt-head">
                <span className="changeset-commit-receipt-sha">
                  Committed {sha === null ? "" : sha.slice(0, 10)}
                </span>
                <TugPushButton
                  size="2xs"
                  emphasis="ghost"
                  role="action"
                  onClick={clear}
                  data-testid="changeset-commit-receipt-dismiss"
                >
                  Dismiss
                </TugPushButton>
              </div>
              <pre className="changeset-commit-receipt-body">{receipt}</pre>
            </div>
          ) : (
            <TugMessageEditor
              ref={editorRef}
              placeholder="Commit message"
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
              data-testid="changeset-commit-message"
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
          className="changeset-file-list"
          data-testid="changeset-unattributed"
        >
          {item.files.map((file) => (
            <ChangesetFileBlock
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
      <div className="changeset-clean" role="status">
        <CircleCheck size={14} />
        {item.kind === "dash" ? "No files past base" : "No changes from this session"}
      </div>
    );
  }

  return (
    <CommitScope>
      <div
        ref={commitRef as (el: HTMLDivElement | null) => void}
        className="changeset-file-list"
      >
        {files.map((file) => (
          <ChangesetFileBlock
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
      </div>
    </CommitScope>
  );
}

// ---------------------------------------------------------------------------
// Table of contents — a TugListView of the entries
// ---------------------------------------------------------------------------

/**
 * Single-section data source over the visible entry list. Recreated whenever
 * the list changes; `subscribe` is therefore a no-op and `getVersion` returns
 * the array identity (a fresh instance ⇒ TugListView re-reads).
 */
class ChangesetTocDataSource implements TugListViewDataSource {
  constructor(private readonly items: readonly ChangesetItem[]) {}
  numberOfItems(): number {
    return this.items.length;
  }
  idForIndex(index: number): string {
    return this.items[index].id;
  }
  kindForIndex(index: number): string {
    return this.items[index].kind;
  }
  itemAt(index: number): ChangesetItem {
    return this.items[index];
  }
  subscribe(): () => void {
    return () => {};
  }
  getVersion(): unknown {
    return this.items;
  }
}

/**
 * One entry row: leading glyph, the entry title over its project · branch ·
 * id subtitle, and a trailing status hint (file count / "clean" / "not a git
 * repo"). Clicking reveals the entry's accordion (via the delegate).
 */
const ChangesetTocCell: TugListViewCellRenderer<ChangesetTocDataSource> =
  function ChangesetTocCell({
    index,
    dataSource,
  }: TugListViewCellProps<ChangesetTocDataSource>): React.ReactElement {
    const item = dataSource.itemAt(index);
    const hint = itemStatusHint(item);
    return (
      <TugListRow
        leading={<ItemGlyph item={item} />}
        title={itemTitle(item)}
        titleSize="sm"
        subtitle={
          // A node (not a string) so the ↑/↓ glyphs can carry their
          // spelled-out tooltip; `.tug-list-row-subtitle` keeps the muted
          // truncating treatment.
          <span title={item.kind === "dash" ? undefined : aheadBehindTitle(item.project)}>
            {itemSubtitle(item)}
          </span>
        }
        trailing={
          <span
            className={`changeset-toc-hint${hint.caution ? " changeset-toc-hint-changes" : ""}`}
          >
            {hint.text}
          </span>
        }
        data-testid="changeset-toc-entry"
        data-entry-id={item.id}
        data-project-dir={item.project.project_dir}
        data-session-id={item.kind === "session" ? item.entry.owner_id : undefined}
      />
    );
  };

const CHANGESET_TOC_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<ChangesetTocDataSource>
> = {
  session: ChangesetTocCell,
  dash: ChangesetTocCell,
  unattributed: ChangesetTocCell,
};

// ---------------------------------------------------------------------------
// ChangesetCardContent
// ---------------------------------------------------------------------------

export function ChangesetCardContent() {
  const data = useChangesetAll();
  const bindings = useOpenBindings();
  const cardRef = useRef<HTMLDivElement | null>(null);

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

  const items = useMemo(() => buildItems(data, bindings), [data, bindings]);

  // Drop per-entry inline-diff stores whose entries have left the snapshot.
  useEffect(() => {
    sweepEntryDiffStores(new Set(items.map((item) => item.id)));
  }, [items]);

  // Controlled accordion ([L11]): the control dispatches toggleSection; the
  // form binding lands it in state. Entries open themselves the first time
  // a snapshot introduces them (tracked by id, so a user's collapse sticks
  // across recomputes).
  const accordionSenderId = useId();
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const { ResponderScope: AccordionScope, responderRef: accordionRef } = useResponderForm({
    toggleSectionMulti: {
      [accordionSenderId]: (v: string[]) => setOpenKeys(v),
    },
  });

  const entryIds = useMemo(() => items.map((item) => item.id), [items]);

  const seenSectionsRef = useRef<Set<string>>(new Set());
  const openNewSections = useCallback((ids: string[]) => {
    const fresh = ids.filter((id) => !seenSectionsRef.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => seenSectionsRef.current.add(id));
    setOpenKeys((prev) => [...prev, ...fresh]);
  }, []);
  useEffect(() => {
    openNewSections(entryIds);
  }, [entryIds, openNewSections]);

  // TOC reveal: after the expand commits, make the revealed entry's trigger
  // visible in the accordion scroller. An already-visible trigger is left
  // alone — the section expands in place with no hop; an out-of-view trigger
  // scrolls to the top so the expanding body has room. Scroller-relative
  // math, so the fixed TOC + toolbar never move. Appearance-only DOM op
  // ([L06]).
  const pendingRevealRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingRevealRef.current === null) return;
    const idx = pendingRevealRef.current;
    pendingRevealRef.current = null;
    const scroller = cardRef.current?.querySelector(".changeset-scroll");
    const trigger = scroller?.querySelector(
      `[data-entry-index="${idx}"] .tug-accordion-trigger`,
    );
    if (!scroller || !trigger) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    if (triggerRect.top >= scrollerRect.top && triggerRect.bottom <= scrollerRect.bottom) {
      return;
    }
    scroller.scrollBy({ top: triggerRect.top - scrollerRect.top, behavior: "smooth" });
  }, [openKeys]);

  const expandAll = useCallback(() => {
    entryIds.forEach((id) => seenSectionsRef.current.add(id));
    setOpenKeys(entryIds);
  }, [entryIds]);
  const collapseAll = useCallback(() => setOpenKeys([]), []);

  const revealEntry = useCallback((item: ChangesetItem, index: number) => {
    seenSectionsRef.current.add(item.id);
    pendingRevealRef.current = index;
    // Adding when absent, or a fresh array when already open, so the reveal
    // effect (keyed on `openKeys` identity) always fires and re-checks.
    setOpenKeys((prev) => (prev.includes(item.id) ? [...prev] : [...prev, item.id]));
  }, []);

  // TOC list: a TugListView over the visible entries. Recreated when the
  // list changes; clicking a row reveals that entry's accordion.
  const tocDataSource = useMemo(() => new ChangesetTocDataSource(items), [items]);
  const tocDelegate = useMemo<TugListViewDelegate>(
    () => ({
      onSelect: (index) => revealEntry(items[index], index),
    }),
    [items, revealEntry],
  );

  const sessionCount = useMemo(
    () => items.filter((item) => item.kind === "session").length,
    [items],
  );

  if (items.length === 0) {
    return (
      <div data-slot="changeset-card" className="changeset-card changeset-card-empty">
        No open sessions
      </div>
    );
  }

  return (
    <div ref={cardRef} data-slot="changeset-card" className="changeset-card">
      <div className="changeset-head">
        <div className="changeset-toolbar">
          <span className="changeset-toolbar-title">
            {sessionCount} session{sessionCount === 1 ? "" : "s"}
          </span>
          <span className="changeset-toolbar-spacer" />
          <TugPushButton
            emphasis="ghost"
            role="action"
            size="2xs"
            onClick={expandAll}
            data-testid="changeset-expand-all"
          >
            Expand all
          </TugPushButton>
          <TugPushButton
            emphasis="ghost"
            role="action"
            size="2xs"
            onClick={collapseAll}
            data-testid="changeset-collapse-all"
          >
            Collapse all
          </TugPushButton>
        </div>
        <TugListView<ChangesetTocDataSource>
          dataSource={tocDataSource}
          delegate={tocDelegate}
          cellRenderers={CHANGESET_TOC_CELL_RENDERERS}
          rowLayout="flush"
          inline
          scrollKey="changeset-toc"
          className="changeset-toc-list"
        />
      </div>
      <AccordionScope>
        <div
          ref={accordionRef as (el: HTMLDivElement | null) => void}
          className="changeset-scroll"
        >
          <TugAccordion
            type="multiple"
            variant="separator"
            value={openKeys}
            senderId={accordionSenderId}
            className="changeset-sections"
          >
            {items.map((item, i) => (
              <TugAccordionItem
                key={item.id}
                value={item.id}
                trigger={<EntryTrigger item={item} />}
                data-testid="changeset-entry"
                data-entry-index={i}
                data-entry-id={item.id}
                data-project-dir={item.project.project_dir}
              >
                <EntryBody item={item} onError={presentNotice} />
              </TugAccordionItem>
            ))}
          </TugAccordion>
        </div>
      </AccordionScope>
      {renderSheet()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerChangesetCard
// ---------------------------------------------------------------------------

/**
 * Register the Changeset card in the global card registry. Call from
 * `main.tsx` before any `DeckManager.addCard("changeset")`.
 */
export function registerChangesetCard(): void {
  registerCard({
    componentId: "changeset",
    contentFactory: () => <ChangesetCardContent />,
    defaultMeta: { title: "Changeset", icon: "GitBranch", closable: true },
    // No per-card feed: the card reads the account-global aggregate via the
    // app-level `useChangesetAll` singleton, not `useCardData`. Declaring
    // CHANGESET_ALL here would route it through the host's per-card,
    // workspace-key-filtered FeedStore — which drops the aggregate frame (it
    // carries no top-level workspace_key), so the host's `feedsReady` gate
    // would hang on "Loading..." forever. An empty list makes the card ready
    // immediately; the singleton store handles delivery.
    cardFeedIds: [],
    sizePolicy: {
      min: { width: 360, height: 280 },
      preferred: { width: 560, height: 480 },
    },
  });
}
