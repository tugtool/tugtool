/**
 * `SessionHistoryView` — the History view-route's transcript-slot view
 * ([P01]/[P10]). On the `↺` route this replaces the transcript with the
 * card's own project git log rendered as one `BlockChrome` block per
 * commit; submitting a question on this route sends an on-record
 * `/tugplug:history` turn (wired in the prompt entry).
 *
 * Data rides the shared `gitLogStore()` (`GIT_LOG` feed) — the card knows
 * its own `projectDir` from the binding, so the Lens-follow indirection is
 * gone. The store is an app-level singleton keyed by one requested root, so
 * `requestLog` fires only while THIS card's History view is the active slot
 * (`active`), and the render gates on `requestedRoot === projectDir` — two
 * cards viewing history of different projects at once is a known
 * single-store limitation, not a correctness hazard (each re-requests when
 * it regains focus). `GIT_HEAD` auto-refreshes the store after a commit.
 *
 * Each commit is one collapsible `BlockChrome`: the collapsed row leads with
 * the short sha (right-click → Copy the full hash), then the subject, with the
 * author · date on the trailing edge. Expanding reveals the full commit message
 * body and the commit's changed files as a {@link CommitChangesList} — the same
 * rows as the `/commit` receipt. The file list rides its own single-shot
 * `GIT_COMMIT_FILES` request (name-status + counts, [P10]); each file's hunks
 * fetch lazily per-row through the commit-flavor GIT_DIFF path.
 *
 * Laws: [L02] the log store enters React through `useSyncExternalStore`;
 * [L06] no appearance state in React.
 *
 * @module components/tugways/cards/session-history/session-history-view
 */

import "./session-history-view.css";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type React from "react";
import { History as HistoryIcon, X } from "lucide-react";

import { BlockChrome } from "@/components/tugways/blocks/block-chrome";
import { ToolBlockHistoryCollapse } from "@/components/tugways/blocks/collapse-context";
import { TugCodeView } from "@/components/tugways/tug-code-view";
import { useCopyableText } from "@/components/tugways/use-copyable-text";
import {
  CommitChangesList,
  type CommitChangesFile,
} from "@/components/tugways/tug-changes-list";
import { dashNameFromTrailer } from "@/lib/landing-receipt";
import { BlockStrip } from "@/components/tugways/blocks/block-strip";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import {
  gitLogStore,
  type GitLogCommit,
  type GitLogStoreSnapshot,
} from "@/lib/git-log-store";
import {
  createCommitFilesStore,
  EMPTY_COMMIT_FILES_SNAPSHOT,
  type GitCommitFilesStoreSnapshot,
} from "@/lib/git-commit-files-store";

const EMPTY_SNAPSHOT: GitLogStoreSnapshot = {
  phase: "idle",
  requestId: null,
  requestedRoot: null,
  payload: null,
  error: null,
};

/** Read the shared Git History store reactively ([L02]). */
function useGitLogSnapshot(): GitLogStoreSnapshot {
  const store = gitLogStore();
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
    () => EMPTY_SNAPSHOT,
  );
}

/** Short-sha display length — enough to uniquely name a commit at a glance. */
const SHA_DISPLAY_LEN = 8;

/**
 * The commit's short sha as `code`-colored monospace text — right-click →
 * Copy writes the full 40-char hash. Leads the header row before the ` : `
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
        className="session-history-commit-sha"
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
  // collapse/unmount (the collapse wrapper unmounts the body while collapsed,
  // so the store's lifetime tracks the expansion exactly).
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
 * The expanded body: the committer's full identity + complete date, then the
 * message body (markdown text styling for list hanging-indent, [markdownText]),
 * then the commit's changed files. The subject is NOT repeated here — it leads
 * the header row above.
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
  const identity =
    email.length > 0 ? `${committer} <${email}>` : committer;
  const files: CommitChangesFile[] =
    snapshot.payload?.files.map((f) => ({
      path: f.path,
      status: f.status,
      added: f.added,
      removed: f.removed,
    })) ?? [];
  return (
    <div className="session-history-commit-body">
      <div className="session-history-commit-meta">
        {identity}
        {fullDate.length > 0 ? ` · ${fullDate}` : null}
      </div>
      {body.length > 0 ? (
        <TugCodeView
          className="session-history-commit-message-view"
          value={body}
          markdownTextStyling
          wrap
          lineNumbers={false}
        />
      ) : null}
      {files.length > 0 ? (
        <CommitChangesList root={projectDir} sha={commit.sha} files={files} />
      ) : snapshot.phase === "ready" ? (
        <div className="session-history-commit-files-empty">
          No file changes.
        </div>
      ) : null}
    </div>
  );
}

function CommitBlock({
  commit,
  projectDir,
}: {
  commit: GitLogCommit;
  projectDir: string;
}): React.ReactElement {
  const meta = `${commit.author} · ${commit.date}`;
  // A commit that landed as a dash join carries the `Tug-Dash:` trailer;
  // History badges it so joins read differently from hand commits ([P09]).
  const dashName = dashNameFromTrailer(commit.tug_dash);
  const fullMessage =
    commit.body !== undefined && commit.body.length > 0
      ? `${commit.subject}\n\n${commit.body}`
      : commit.subject;
  return (
    <div className="session-history-commit" data-testid="session-history-commit">
      <ToolBlockHistoryCollapse
        toolUseId={commit.sha}
        defaultCollapsed
        copyText={`${commit.sha}\n\n${fullMessage}`}
      >
        <BlockChrome
          variant="tool"
          phase="idle"
          // `null` (not the dot, not a glyph) — the hash leads the identity
          // instead; the empty leading slot is collapsed away in CSS so the
          // hash sits at the row's left edge.
          leading={null}
          identity={
            <span
              className="session-history-commit-header tool-call-header-clamp"
              title={commit.subject}
            >
              <CommitShaText sha={commit.sha} />
              <span className="session-history-commit-delim">{" : "}</span>
              {commit.subject}
              {dashName !== null ? (
                <span
                  className="session-history-join-badge"
                  data-testid="session-history-join-badge"
                >
                  from dash {dashName}
                </span>
              ) : null}
            </span>
          }
          resultSummary={{ kind: "text", text: meta }}
        >
          <CommitDetail commit={commit} projectDir={projectDir} />
        </BlockChrome>
      </ToolBlockHistoryCollapse>
    </div>
  );
}

export interface SessionHistoryViewProps {
  /** Repo-relative project directory the card is bound to. */
  projectDir: string | null;
  /** True while the `↺` route is the active slot — gates the singleton request. */
  active: boolean;
  /** Hide the Shade — the header's close affordance ([P05]). */
  onClose?: () => void;
}

export function SessionHistoryView({
  projectDir,
  active,
  onClose,
}: SessionHistoryViewProps): React.ReactElement {
  const snapshot = useGitLogSnapshot();

  // Request only while this card's History view is the active slot (the store
  // is a singleton keyed by one root). Idempotent via the store's
  // requested-key guard; `GIT_HEAD` auto-refreshes the store after a commit.
  // Re-request when the singleton's root has drifted away from ours (another
  // card requested its project while we were away).
  useEffect(() => {
    if (!active || projectDir === null) return;
    if (snapshot.requestedRoot === projectDir && snapshot.phase !== "error") {
      return;
    }
    gitLogStore()?.requestLog(projectDir);
  }, [active, projectDir, snapshot.requestedRoot, snapshot.phase]);

  // The view fills the sheet's shade body ([P17]): the header strip pinned
  // above, the scrolling view below. The shade panel (geometry, scrim,
  // grabber, modality, Escape close) is `TugSheetContent
  // presentation="shade"` — mounted by the Session card around this view.
  const shell = (children: React.ReactNode): React.ReactElement => (
    <>
      <div className="tug-sheet-shade-header">
        <BlockStrip
          altitude="section"
          className="tool-call-header"
          dataTestid="session-history-header"
          leading={
            <span className="tool-call-header-leading" aria-hidden="true">
              <HistoryIcon size={14} />
            </span>
          }
          name="History"
          actions={
            onClose !== undefined ? (
              <TugIconButton
                icon={<X size={12} strokeWidth={2.5} />}
                aria-label="Close"
                size="2xs"
                emphasis="ghost"
                onClick={onClose}
              />
            ) : undefined
          }
        />
      </div>
      <div
        className="session-history-view"
        data-slot="session-history-view"
        data-tug-focus="refuse"
      >
        {children}
      </div>
    </>
  );

  if (projectDir === null) {
    return shell(
      <div className="session-history-empty">No project bound to this session.</div>,
    );
  }

  // While the singleton is showing another card's project, treat it as loading
  // for us until our request lands.
  const payload =
    snapshot.requestedRoot === projectDir ? snapshot.payload : null;

  if (payload?.no_repo) {
    return shell(
      <div className="session-history-empty">Not a git repository.</div>,
    );
  }
  if (snapshot.requestedRoot === projectDir && snapshot.phase === "error") {
    return shell(
      <div className="session-history-empty">
        {snapshot.error ?? "Failed to load history."}
      </div>,
    );
  }
  if (payload === null) {
    return shell(<div className="session-history-empty">Loading history…</div>);
  }
  if (payload.commits.length === 0) {
    return shell(<div className="session-history-empty">No commits yet.</div>);
  }

  return shell(
    <div className="session-history-view-body">
      {payload.commits.map((commit) => (
        <CommitBlock key={commit.sha} commit={commit} projectDir={projectDir} />
      ))}
    </div>,
  );
}
