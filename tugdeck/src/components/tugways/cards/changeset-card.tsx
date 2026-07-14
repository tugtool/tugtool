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
import { CircleCheck, CircleDashed, GitCompareArrows } from "lucide-react";

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
import { TugInput } from "@/components/tugways/tug-input";
import { presentAlertSheet } from "@/components/tugways/tug-alert-sheet";
import { useDiffSheet } from "./diff-sheet";
import { useChangesetAll } from "@/lib/changeset-all-store";
import {
  useChangesetCommit,
  useChangesetGitInit,
  useChangesetSummarize,
} from "@/lib/changeset-verb-store";
import { getChangesetDiffStore } from "@/lib/changeset-diff-store";
import type { GitDiffScope } from "@/lib/git-diff-store";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import type {
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

/** The per-file diff affordance — opens the diff sheet scoped to one path. */
function FileDiffButton({ path, onDiff }: { path: string; onDiff: () => void }) {
  return (
    <TugPushButton
      subtype="icon"
      icon={<GitCompareArrows size={12} />}
      size="2xs"
      emphasis="ghost"
      role="action"
      title="Show diff"
      aria-label={`Show diff for ${path}`}
      data-testid="changeset-file-diff"
      data-path={path}
      onClick={onDiff}
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

function FileRow({
  file,
  projectRoot,
  onDiff,
  selection,
}: {
  file: ChangesetFile;
  projectRoot: string;
  onDiff?: () => void;
  selection?: RowSelection;
}) {
  return (
    <div className="changeset-file-row" data-testid="changeset-file">
      {selection !== undefined && (
        <FileSelectCheckbox
          path={file.path}
          senderId={selection.senderId}
          selected={selection.selected}
          disabled={selection.disabled}
        />
      )}
      <span className={`changeset-file-status ${statusToneClass(file.git_status)}`}>
        {statusGlyph(file.git_status)}
      </span>
      <FilePathLink
        path={file.path}
        op={file.op}
        gitStatus={file.git_status}
        projectRoot={projectRoot}
      />
      {file.ambiguous && (
        <span className="changeset-badge changeset-badge-ambiguous">ambiguous</span>
      )}
      {file.shared && <span className="changeset-badge changeset-badge-shared">shared</span>}
      <span className="changeset-file-provenance">
        {file.origin === "dash" ? file.op : `${file.op} · ${file.origin}`}
      </span>
      {onDiff !== undefined && <FileDiffButton path={file.path} onDiff={onDiff} />}
    </div>
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

/** A file the entry can commit: its path plus its default selection. */
interface SelectableFile {
  path: string;
  /** Ambiguous and shared rows start deselected — explicit opt-in ([P15]). */
  defaultSelected: boolean;
}

/**
 * The expanded body of one entry — its file list (or clean/init state) plus
 * the commit flow ([P15]).
 *
 * `onDiff` opens the shared diff sheet scoped to a pathspec within the
 * entry's project. It applies to session and unattributed entries (working
 * tree vs HEAD) — a dash entry's files are commits past its base, which a
 * `git diff HEAD` in the project dir cannot show, so dashes get no diff
 * affordance. Untracked files likewise (no HEAD side).
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
  onDiff,
  onError,
  onInfo,
}: {
  item: ChangesetItem;
  onDiff?: (scope: GitDiffScope) => void;
  onError?: (title: string, message: string) => void;
  onInfo?: (title: string, message: string) => void;
}) {
  const projectRoot = item.project.project_dir;

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
  const { phase, error, sha, receipt, commit, clear } = useChangesetCommit(item.id);

  // Scribe round trips ([P11]): "Draft message" fills the commit-message
  // field; "Summarize" presents its text as an info sheet.
  const draft = useChangesetSummarize(item.id, "commit_message");
  const summary = useChangesetSummarize(item.id, "summary");
  const ownerKind = item.kind;
  const ownerId = item.kind === "unattributed" ? "" : item.entry.owner_id;

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

  // A landed commit clears the drafted message; the receipt panel stays up
  // until dismissed (or until the next commit round).
  useEffect(() => {
    if (phase === "done") setMessage("");
  }, [phase]);

  // The drafted message lands in the message field; the summary lands in an
  // info sheet. Both scribe states clear on consumption so the buttons are
  // immediately reusable; failures surface like commit failures.
  const draftClear = draft.clear;
  const summaryClear = summary.clear;
  useEffect(() => {
    if (draft.phase === "done" && draft.text !== null) {
      setMessage(draft.text);
      draftClear();
    } else if (draft.phase === "error" && draft.error !== null) {
      onError?.("Couldn't Draft a Message", draft.error);
      draftClear();
    }
  }, [draft.phase, draft.text, draft.error, draftClear, onError]);
  useEffect(() => {
    if (summary.phase === "done" && summary.text !== null) {
      onInfo?.("Summary", summary.text);
      summaryClear();
    } else if (summary.phase === "error" && summary.error !== null) {
      onError?.("Couldn't Summarize", summary.error);
      summaryClear();
    }
  }, [summary.phase, summary.text, summary.error, summaryClear, onError, onInfo]);

  if (item.kind === "session" && item.project.no_repo) {
    return <NonRepoBody projectDir={item.project.project_dir} />;
  }

  const files = item.kind === "unattributed" ? null : item.entry.files;
  const diffScoped =
    item.kind === "dash" || onDiff === undefined
      ? undefined
      : (paths: string[]) => onDiff({ root: projectRoot, paths });

  // The entry's action row: Summarize (all of the entry's files) plus a
  // whole-changeset diff when more than one file has a HEAD side.
  const entryActionsRow = (diffablePaths: string[], allPaths: string[]) => {
    const summarizeButton =
      selectable.length === 0 ? null : (
        <TugPushButton
          emphasis="ghost"
          role="action"
          size="2xs"
          disabled={summary.phase === "pending"}
          widthStabilize={{ alternateLabel: "Summarizing…" }}
          onClick={() =>
            summary.summarize({ projectDir: projectRoot, ownerKind, ownerId, files: allPaths })
          }
          data-testid="changeset-entry-summarize"
        >
          {summary.phase === "pending" ? "Summarizing…" : "Summarize"}
        </TugPushButton>
      );
    const diffButton =
      diffScoped !== undefined && diffablePaths.length > 1 ? (
        <TugPushButton
          emphasis="ghost"
          role="action"
          size="2xs"
          onClick={() => diffScoped(diffablePaths)}
          data-testid="changeset-entry-diff"
        >
          Diff {diffablePaths.length} files
        </TugPushButton>
      ) : null;
    if (summarizeButton === null && diffButton === null) return null;
    return (
      <div className="changeset-entry-actions">
        {summarizeButton}
        {diffButton}
      </div>
    );
  };

  const rowSelection = (path: string): RowSelection => ({
    senderId: selectSender(path),
    selected: overrides.get(path) ?? selectable.find((f) => f.path === path)?.defaultSelected ?? true,
    disabled: phase === "pending",
  });

  const commitControls =
    selectable.length === 0 ? null : (
      <div className="changeset-commit" data-testid="changeset-commit-controls">
        {phase === "done" && receipt !== null ? (
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
          <div className="changeset-commit-row">
            <TugInput
              size="sm"
              placeholder="Commit message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={phase === "pending"}
              aria-label="Commit message"
              data-testid="changeset-commit-message"
            />
            <TugPushButton
              size="sm"
              emphasis="ghost"
              role="action"
              disabled={draft.phase === "pending" || selectedPaths.length === 0}
              widthStabilize={{ alternateLabel: "Drafting…" }}
              onClick={() =>
                draft.summarize({
                  projectDir: projectRoot,
                  ownerKind,
                  ownerId,
                  files: selectedPaths,
                })
              }
              data-testid="changeset-draft-message"
            >
              {draft.phase === "pending" ? "Drafting…" : "Draft"}
            </TugPushButton>
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
          </div>
        )}
      </div>
    );

  if (item.kind === "unattributed") {
    const diffablePaths = item.files
      .filter((file) => hasHeadDiff(file.git_status))
      .map((file) => file.path);
    return (
      <CommitScope>
        <div
          ref={commitRef as (el: HTMLDivElement | null) => void}
          className="changeset-file-list"
          data-testid="changeset-unattributed"
        >
          {item.files.map((file) => {
            const selection = rowSelection(file.path);
            return (
              <div className="changeset-file-row" data-testid="changeset-file" key={file.path}>
                <FileSelectCheckbox
                  path={file.path}
                  senderId={selection.senderId}
                  selected={selection.selected}
                  disabled={selection.disabled}
                />
                <span className={`changeset-file-status ${statusToneClass(file.git_status)}`}>
                  {statusGlyph(file.git_status)}
                </span>
                <FilePathLink
                  path={file.path}
                  op=""
                  gitStatus={file.git_status}
                  projectRoot={projectRoot}
                />
                {diffScoped !== undefined && hasHeadDiff(file.git_status) && (
                  <span className="changeset-file-trailing">
                    <FileDiffButton path={file.path} onDiff={() => diffScoped([file.path])} />
                  </span>
                )}
              </div>
            );
          })}
          {entryActionsRow(diffablePaths, item.files.map((file) => file.path))}
          {commitControls}
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

  const diffablePaths = files
    .filter((file) => hasHeadDiff(file.git_status))
    .map((file) => file.path);
  return (
    <CommitScope>
      <div
        ref={commitRef as (el: HTMLDivElement | null) => void}
        className="changeset-file-list"
      >
        {files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            projectRoot={projectRoot}
            onDiff={
              diffScoped !== undefined && hasHeadDiff(file.git_status)
                ? () => diffScoped([file.path])
                : undefined
            }
            selection={item.kind === "session" ? rowSelection(file.path) : undefined}
          />
        ))}
        {entryActionsRow(diffablePaths, files.map((file) => file.path))}
        {commitControls}
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

  // The shared diff sheet, hosted by this card. The store is the app-level
  // changeset diff singleton (unfiltered — every project flows through it);
  // each open names its project via the scope's `root`.
  const { showSheet, renderSheet } = useTugSheet();
  const { openDiffSheet } = useDiffSheet({
    gitDiffStore: getChangesetDiffStore(),
    showSheet,
  });

  // Verb failures (commit, scribe) and scribe summaries surface as a
  // pane-modal TugAlert sheet.
  const presentNotice = useCallback(
    (title: string, message: string) => {
      void presentAlertSheet(showSheet, { title, message });
    },
    [showSheet],
  );

  const items = useMemo(() => buildItems(data, bindings), [data, bindings]);

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
                <EntryBody
                  item={item}
                  onDiff={openDiffSheet}
                  onError={presentNotice}
                  onInfo={presentNotice}
                />
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
