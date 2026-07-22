/**
 * `TugHistoryList` — a read-only list of commits with inline detail ([P10]).
 * One compact mono `TugListRow` per commit — the same row density as
 * {@link TugChangesList}'s file rows: the short sha (right-click → Copy the
 * full hash) leads the ` : ` subject; the author · date and a fold cue sit on
 * the trailing edge, over a detail body that expands and collapses in place.
 *
 * Expanding reveals the full commit message (markdown text styling for list
 * hanging-indent), the commit's changed files as a {@link CommitChangesList}
 * (its own single-shot `GIT_COMMIT_FILES` request, hunks lazy per row), and
 * the committer's full identity + complete date, right-aligned at the bottom.
 *
 * Presentation carries no lifecycle dot — a landed commit has no lifecycle.
 * Per-commit collapse is UNCONTROLLED (local `useState`, like a receipt row);
 * the detail body mounts on expand and unmounts on collapse ([L26]), so each
 * expanded row's commit-files store lives exactly as long as its body.
 *
 * Laws: [L02] the commit-files store enters React through
 * `useSyncExternalStore`; [L06] tones and hover affordances paint via CSS,
 * never React state; [L26] the detail body collapses by unmount.
 *
 * @module components/tugways/tug-history-list
 */

import "./tug-history-list.css";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";

import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugCodeView } from "@/components/tugways/tug-code-view";
import { useCopyableText } from "@/components/tugways/use-copyable-text";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import {
  CommitChangesList,
  type CommitChangesFile,
} from "@/components/tugways/tug-changes-list";
import { dashNameFromTrailer } from "@/lib/landing-receipt";
import type { GitLogCommit } from "@/lib/git-log-store";
import {
  createCommitFilesStore,
  EMPTY_COMMIT_FILES_SNAPSHOT,
  type GitCommitFilesStoreSnapshot,
} from "@/lib/git-commit-files-store";

/** Short-sha display length — enough to uniquely name a commit at a glance. */
const SHA_DISPLAY_LEN = 8;

/**
 * The commit's short sha as `code`-colored monospace text — right-click →
 * Copy writes the full 40-char hash. Leads the row before the ` : `
 * delimiter and the subject.
 */
function CommitShaText({ sha }: { sha: string }): React.ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const { composedRef, handleContextMenu, contextMenu } = useCopyableText({
    ref,
    getText: () => sha,
    copyMenu: true,
  });
  return (
    <>
      <code
        ref={composedRef}
        className="tug-history-list-commit-sha"
        onContextMenu={handleContextMenu}
      >
        {sha.slice(0, SHA_DISPLAY_LEN)}
      </code>
      {contextMenu}
    </>
  );
}

/** Format a strict-ISO committer date into a complete, readable timestamp. */
function formatCommitterDate(iso: string): string {
  if (iso.length === 0) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Read one expanded row's commit-files store reactively ([L02]). */
function useCommitFilesSnapshot(
  root: string,
  sha: string,
): GitCommitFilesStoreSnapshot {
  // One store per expanded body: created on mount, disposed on
  // collapse/unmount (the body unmounts while collapsed, so the store's
  // lifetime tracks the expansion exactly).
  const store = useMemo(() => createCommitFilesStore(), []);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => EMPTY_COMMIT_FILES_SNAPSHOT),
    () => EMPTY_COMMIT_FILES_SNAPSHOT,
  );
  useEffect(() => {
    store?.requestFiles(root, sha);
    return () => store?.dispose();
  }, [store, root, sha]);
  return snapshot;
}

/**
 * The expanded detail: the message body (markdown text styling for list
 * hanging-indent), the commit's changed files, and finally the committer's
 * full identity + complete date, right-aligned at the bottom. The subject is
 * NOT repeated here — it leads the row above.
 */
function CommitDetail({
  commit,
  projectDir,
}: {
  commit: GitLogCommit;
  projectDir: string;
}): React.ReactElement {
  const snapshot = useCommitFilesSnapshot(projectDir, commit.sha);
  const body = commit.body ?? "";
  const committer = commit.committer ?? commit.author;
  const email = commit.committer_email ?? "";
  const fullDate = formatCommitterDate(commit.committer_date ?? "");
  const identity = email.length > 0 ? `${committer} <${email}>` : committer;
  const files: CommitChangesFile[] =
    snapshot.payload?.files.map((f) => ({
      path: f.path,
      status: f.status,
      added: f.added,
      removed: f.removed,
    })) ?? [];
  return (
    <div className="tug-history-list-commit-detail">
      {body.length > 0 ? (
        <TugCodeView
          className="tug-history-list-commit-message-view"
          value={body}
          markdownTextStyling
          wrap
          lineNumbers={false}
        />
      ) : null}
      {files.length > 0 ? (
        <CommitChangesList root={projectDir} sha={commit.sha} files={files} />
      ) : snapshot.phase === "ready" ? (
        <div className="tug-history-list-commit-files-empty">
          No file changes.
        </div>
      ) : null}
      <div className="tug-history-list-commit-meta">
        {identity}
        {fullDate.length > 0 ? ` · ${fullDate}` : null}
      </div>
    </div>
  );
}

/**
 * One commit's compact row + expandable detail: a `flush` `compact` `mono`
 * `TugListRow` (short sha ` : ` subject in the content column; author · date +
 * fold cue trailing) over a mount-on-expand detail body ([L26]). The whole row
 * is the fold's click target; the sha's copy menu and the trailing controls own
 * their own gestures and stop propagation.
 */
function CommitRow({
  commit,
  projectDir,
}: {
  commit: GitLogCommit;
  projectDir: string;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const meta = `${commit.author} · ${commit.date}`;
  // A commit that landed as a dash join carries the `Tug-Dash:` trailer;
  // History badges it so joins read differently from hand commits ([P09]).
  const dashName = dashNameFromTrailer(commit.tug_dash);
  return (
    <div
      className="tug-history-list-commit-block"
      data-testid="session-history-commit"
      data-sha={commit.sha}
      data-expanded={expanded ? "true" : undefined}
    >
      <div
        className="tug-history-list-row-hit"
        onClick={() => setExpanded((e) => !e)}
      >
        <TugListRow
          variant="flush"
          density="compact"
          mono
          trailing={
            <span
              className="tug-history-list-row-trailing"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="tug-history-list-commit-attribution">{meta}</span>
              <BlockFoldCue
                collapsed={!expanded}
                onToggle={(nextCollapsed) => setExpanded(!nextCollapsed)}
                collapsedLabel="Expand commit"
                ariaLabelExpand={`Show detail for ${commit.subject}`}
                ariaLabelCollapse={`Hide detail for ${commit.subject}`}
                size="2xs"
                subtype="icon"
                stabilizeScroll={false}
                data-slot="tug-history-list-fold"
              />
            </span>
          }
        >
          <span
            className="tug-history-list-commit-header"
            title={commit.subject}
          >
            <CommitShaText sha={commit.sha} />
            <span className="tug-history-list-commit-delim">{" : "}</span>
            {commit.subject}
            {dashName !== null ? (
              <span
                className="tug-history-list-join-badge"
                data-testid="session-history-join-badge"
              >
                from dash {dashName}
              </span>
            ) : null}
          </span>
        </TugListRow>
      </div>
      {expanded ? (
        <CommitDetail commit={commit} projectDir={projectDir} />
      ) : null}
    </div>
  );
}

export interface TugHistoryListProps {
  /** The commits to render, newest first. */
  commits: readonly GitLogCommit[];
  /** The project dir the commits live in (resolves the workspace for files). */
  projectDir: string;
  className?: string;
}

export function TugHistoryList({
  commits,
  projectDir,
  className,
}: TugHistoryListProps): React.ReactElement {
  return (
    <div
      className={
        className !== undefined
          ? `tug-history-list ${className}`
          : "tug-history-list"
      }
      data-slot="tug-history-list"
    >
      {commits.map((commit) => (
        <CommitRow key={commit.sha} commit={commit} projectDir={projectDir} />
      ))}
    </div>
  );
}
