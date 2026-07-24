/**
 * `TugHistoryList` — a read-only list of commits with inline detail ([P10]).
 * One compact mono `TugListRow` per commit — the same row density as
 * {@link TugChangesList}'s file rows: the shared {@link CommitIdentityLine}
 * (`<sha> : <subject>`) leads; a reader-chosen metadata cell, a Copy control,
 * and a fold cue sit on the trailing edge, over a detail body that expands and
 * collapses in place.
 *
 * Type, leading, and layout come from the `.tugx-commit` scale
 * (`commit-presentation.css`), the same scale the `/commit` durable receipt
 * wears — one commit reads identically in the shade and in the transcript.
 *
 * The trailing metadata is a choice, not a default: `metaFields` says which of
 * author / date / time each row carries, so a reader who wants the committer
 * and one who wants the clock both get the list they asked for.
 *
 * Expanding reveals the full commit message, the commit's changed files as a
 * {@link CommitChangesList} (its own single-shot `GIT_COMMIT_FILES` request,
 * hunks lazy per row), and the committer's full identity + complete date,
 * right-aligned at the bottom. Copy writes the whole record — the complete
 * 40-char hash, attribution, and message — whatever the fold state.
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

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type React from "react";

import { TugListRow } from "@/components/tugways/tug-list-row";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import {
  CommitCopyControl,
  CommitIdentityLine,
  CommitMetaCell,
  commitCopyText,
  formatCommitStamp,
  type CommitMetaField,
} from "@/components/tugways/commit-presentation";
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
 * The expanded detail: the message body at the shared `.tugx-commit-message`
 * scale, the commit's changed files, and finally the committer's full identity
 * + complete date, right-aligned at the bottom. The subject is NOT repeated
 * here — it leads the row above.
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
  const fullDate = formatCommitStamp(commit.committer_date ?? "", "full");
  const identity = email.length > 0 ? `${committer} <${email}>` : committer;
  const files: CommitChangesFile[] =
    snapshot.payload?.files.map((f) => ({
      path: f.path,
      status: f.status,
      added: f.added,
      removed: f.removed,
    })) ?? [];
  return (
    <div className="tug-history-list-commit-detail tugx-commit-detail">
      {body.length > 0 ? (
        <pre className="tugx-commit-message" data-slot="tug-history-list-message">
          {body}
        </pre>
      ) : null}
      {files.length > 0 ? (
        <CommitChangesList root={projectDir} sha={commit.sha} files={files} />
      ) : snapshot.phase === "ready" ? (
        <div className="tug-history-list-commit-files-empty">
          No file changes.
        </div>
      ) : null}
      <div className="tug-history-list-commit-meta tugx-commit-attribution">
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
  metaFields,
}: {
  commit: GitLogCommit;
  projectDir: string;
  metaFields: readonly CommitMetaField[];
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
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
      {/* Primary button only — a right-click belongs to the sha's copy menu,
          and must never fold the row under it. */}
      <div
        className="tug-history-list-row-hit"
        onClick={(event) => {
          if (event.button !== 0) return;
          setExpanded((e) => !e);
        }}
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
              <CommitMetaCell
                author={commit.committer ?? commit.author}
                iso={commit.committer_date ?? ""}
                fields={metaFields}
              />
              <CommitCopyControl
                getText={() =>
                  commitCopyText({
                    sha: commit.sha,
                    subject: commit.subject,
                    body: commit.body,
                    author: commit.committer ?? commit.author,
                    email: commit.committer_email,
                    dateIso: commit.committer_date,
                  })
                }
                subject={commit.subject}
              />
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
          <CommitIdentityLine
            sha={commit.sha}
            subject={commit.subject}
            className="tug-history-list-commit-header"
            badge={
              dashName !== null ? (
                <span
                  className="tug-history-list-join-badge"
                  data-testid="session-history-join-badge"
                >
                  from dash {dashName}
                </span>
              ) : undefined
            }
          />
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
  /**
   * Which metadata each collapsed row carries on its trailing edge. Date and
   * time together read as one stamp; the host owns the choice (and its
   * persistence).
   */
  metaFields?: readonly CommitMetaField[];
  className?: string;
}

/** Date + time — a complete stamp, the reading a bare date can't give. */
const DEFAULT_META_FIELDS: readonly CommitMetaField[] = ["date", "time"];

export function TugHistoryList({
  commits,
  projectDir,
  metaFields = DEFAULT_META_FIELDS,
  className,
}: TugHistoryListProps): React.ReactElement {
  return (
    <div
      className={
        className !== undefined
          ? `tug-history-list tugx-commit ${className}`
          : "tug-history-list tugx-commit"
      }
      data-slot="tug-history-list"
    >
      {commits.map((commit) => (
        <CommitRow
          key={commit.sha}
          commit={commit}
          projectDir={projectDir}
          metaFields={metaFields}
        />
      ))}
    </div>
  );
}
